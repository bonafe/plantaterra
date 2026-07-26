# PlantaTerra — Especificação Funcional e Técnica

## 1. Objetivo

Aplicação web (PWA, mobile-first) para uso em campo que permite, usando apenas o celular:

1. **Mapear o perímetro de uma propriedade** caminhando pela divisa com o GPS ligado, gerando um polígono georreferenciado.
2. **Levantar a curva de nível (relevo) do terreno** combinando leituras de GPS com medições de um **nível a laser rotativo** (o aparelho fica fixo em um ponto emitindo uma linha/plano horizontal de laser; a pessoa anda pelo terreno com uma régua/mira e lê a que altura o laser incide sobre ela em cada ponto).
3. **Visualizar o resultado** — perímetro + pontos + curvas de nível — sobre um mapa real.

O código em `src/html/curvanivel*` é o protótipo anterior e serve **apenas como referência de ideias** (estrutura de eventos do GPS, entidades de domínio, uso de IndexedDB). A implementação nova é escrita do zero.

Todo o texto de interface e desta especificação é em **pt-BR**.

## 2. Decisões técnicas (confirmadas com o usuário)

| Decisão | Escolha |
|---|---|
| Framework / build | **Vanilla JS puro, sem bundler, sem framework.** ES Modules nativos do navegador (`<script type="module">`), servidos como arquivos estáticos. |
| Bibliotecas de terceiros | **Vendorizadas** (baixadas e commitadas no repositório, ex. `vendor/leaflet/`), nunca via CDN — o app precisa abrir offline em campo. |
| Persistência | **Local-first**, IndexedDB no navegador. Sem backend. Exportação/Importação de projeto em arquivo (GeoJSON/JSON) para backup e transferência entre aparelhos. |
| Mapa base | **Leaflet** + tiles OpenStreetMap, com cache de tiles já visitados (para reabrir o mapa offline na mesma área). |
| Leitura do laser | **Manual** (a pessoa lê a régua/mira e digita a altura). Leitura automática por câmera é trabalho futuro (ver §10). |
| Instalação | PWA instalável (manifest + service worker), para abrir em tela cheia e funcionar sem sinal de internet no terreno. |

## 3. Conceitos de domínio (glossário)

- **Projeto**: uma propriedade/terreno sendo levantado. Contém um perímetro (opcional) e um ou mais registros de nível.
- **Trilha de perímetro (`Trilha`)**: sequência de coordenadas GPS capturadas enquanto a pessoa caminha pela divisa do terreno. Vira um polígono fechado.
- **Estação de nível (`EstacaoNivel`)**: um local fixo onde o nível a laser rotativo foi instalado durante um período de leituras. Tem uma coordenada GPS própria e uma **altura de instrumento** (altura do plano do laser acima do chão nesse ponto).
- **Leitura (`Leitura`)**: um ponto do terreno visitado enquanto uma `EstacaoNivel` está ativa. Contém a coordenada GPS do ponto e a **altura lida na mira** (distância vertical do chão até onde o feixe do laser incide).
- **Ponto de amarração (`PontoAmarracao`)**: uma leitura que foi repetida em duas `EstacaoNivel` diferentes (a pessoa não move a mira, só o instrumento), usada para conectar as altitudes relativas de duas estações em uma única referência.
- **Curva de nível**: linha de altitude relativa constante, calculada por interpolação a partir de todas as `Leitura`s de todas as `EstacaoNivel` de um projeto, já unificadas pelos pontos de amarração.

## 4. Fundamento do cálculo de altitude (nivelamento ótico)

Um nível a laser rotativo emite um plano horizontal de luz a 360°. Isso significa que **todos os pontos atingidos pelo feixe, em qualquer direção, estão exatamente na mesma altitude absoluta** (a altitude do próprio instrumento).

Para cada `EstacaoNivel` com altura de instrumento `H_instrumento` (medida da base do tripé/instrumento até o plano do laser) instalada num ponto de altitude relativa `A_estacao` (arbitrária, ex. `0` para a primeira estação de um projeto):

```
altitude_do_plano_do_laser = A_estacao + H_instrumento
```

Para cada `Leitura` feita nessa estação, em que a pessoa segura a mira e lê a altura `h_leitura` em que o feixe incide na régua:

```
altitude_relativa(ponto_da_leitura) = altitude_do_plano_do_laser - h_leitura
                                     = A_estacao + H_instrumento - h_leitura
```

### Conectando múltiplas estações (pontos de amarração)

Como o instrumento tem alcance/linha de visada limitados, o usuário eventualmente muda o laser de lugar, criando uma nova `EstacaoNivel`. Para que as leituras da nova estação fiquem na **mesma referência de altitude** das anteriores, a última leitura antes de mover o instrumento (ou a primeira depois) deve ser repetida com a mira **parada no mesmo lugar físico**, uma vez com cada estação — esse é o ponto de amarração.

Dado um ponto de amarração lido pela estação `E1` (já com altitude relativa conhecida `alt_1`) e novamente pela estação `E2` (recém-criada, ainda com `A_estacao = 0` provisório):

```
alt_2_bruta = 0 + H_instrumento_E2 - h_leitura_amarracao_em_E2
offset_E2   = alt_1 - alt_2_bruta
A_estacao(E2) = offset_E2
```

Esse `offset` é somado a todas as leituras da `E2` (e de estações futuras amarradas a ela), formando uma cadeia de nivelamento — a mesma técnica usada em topografia clássica com nível ótico, adaptada para o nível a laser + GPS.

Se o usuário não fizer amarração entre estações, cada `EstacaoNivel` fica com sua própria referência local (`A_estacao = 0`) e o app deixa isso explícito na interface (curvas de nível calculadas por estação, sem juntar todas no mesmo mapa de altitude).

## 5. Estabilização da coordenada GPS

O GPS de celular tem ruído de alguns metros. Ideia herdada do protótipo antigo, refinada:

1. Ao "capturar" uma coordenada (seja para uma leitura, seja para um ponto de estação), o app coleta **N amostras sucessivas** via `watchPosition` (com `enableHighAccuracy: true`).
2. N é adaptativo: para de coletar quando (a) já coletou pelo menos `N_min` amostras (padrão 5) **e** (b) o desvio padrão das últimas `N_min` amostras é menor que um limiar (padrão 3 m) **ou** foi atingido um tempo máximo de espera (padrão 15 s, para não travar o usuário no campo).
3. Amostras com `accuracy` (precisão reportada pelo GPS) pior que um limite configurável (padrão 20 m) são descartadas antes da média.
4. A coordenada final é a **média das amostras aceitas** (não o centróide de *todas* as amostras brutas, que o protótipo antigo calculava incluindo outliers).
5. A UI mostra em tempo real: número de amostras coletadas, precisão atual reportada pelo GPS, e um indicador visual de "qualidade do sinal" (verde/amarelo/vermelho conforme a precisão).
6. Se a precisão nunca atingir um mínimo aceitável dentro do tempo máximo, o app avisa o usuário e permite: aceitar mesmo assim (marcando a leitura como "baixa precisão") ou tentar de novo.

Esse fluxo é usado tanto para capturar a coordenada de uma `EstacaoNivel` quanto de cada `Leitura`.

## 6. Captura de trilha do perímetro

Diferente da captura de um ponto único, aqui o GPS fica ligado continuamente enquanto a pessoa caminha:

1. Usuário aperta "Iniciar caminhada do perímetro".
2. App usa `watchPosition` continuamente, adicionando um ponto à trilha sempre que a posição nova estiver a mais de uma distância mínima da última posição registrada (padrão 3 m, configurável) — evita acumular ruído parado no mesmo lugar.
3. Mapa mostra a trilha sendo desenhada em tempo real (polyline no Leaflet), com a posição atual do usuário destacada.
4. Usuário pode pausar/retomar (ex. parar para almoçar) e apagar o último ponto se caminhar por engano.
5. Ao apertar "Concluir perímetro": a trilha bruta passa por **simplificação (algoritmo de Douglas-Peucker)** para remover ruído mantendo a forma, e é fechada (conectando o último ponto ao primeiro) para virar um polígono.
6. O polígono resultante fica associado ao projeto e é exibido permanentemente sobre o mapa. Pode ser refeito a qualquer momento (gera uma nova trilha, substituindo ou salvando como versão).
7. Área do polígono (m² e hectares) é calculada e exibida (fórmula de área geodésica aproximada, ex. shoelace sobre projeção local equirretangular — suficiente para propriedades rurais de porte comum).

## 7. Geração das curvas de nível

Entrada: lista de pontos `(lat, lon, altitude_relativa)` vindos de todas as `Leitura`s do projeto (já ajustadas pelos offsets de amarração), mais opcionalmente as `EstacaoNivel` (também têm coordenada + altitude, podem entrar como pontos de leitura implícitos).

Pipeline:

1. **Projeção local**: converter lat/lon para um plano cartesiano local em metros (projeção equirretangular simples centrada no centróide dos pontos — precisão suficiente na escala de uma propriedade, evita a complexidade de UTM completo).
2. **Interpolação em grade regular**: usar **IDW (Inverse Distance Weighting)** sobre uma grade regular (resolução configurável, padrão ~1/50 da menor dimensão do terreno) para estimar a altitude em cada célula a partir dos pontos medidos vizinhos. Escolhido em vez de triangulação/krigagem por ser simples de implementar sem bibliotecas externas e robusto com poucos pontos esparsos (situação comum em campo).
3. **Extração de isolinhas**: algoritmo de **Marching Squares** sobre a grade interpolada, com um espaçamento de curva configurável (padrão sugerido automaticamente a partir do desnível total medido, ex. desnível/10).
4. **Reprojeção** das isolinhas de volta para lat/lon e desenho no Leaflet como polylines, uma cor por faixa de altitude (rótulo com o valor da curva).
5. Fora do polígono do perímetro (quando existir), as curvas são recortadas/ocultadas — não extrapolar visualmente para fora da propriedade.
6. Pontos de leitura brutos ficam disponíveis como uma camada que pode ser ligada/desligada (para conferência), assim como o rótulo de qual `EstacaoNivel` cada leitura pertence.

Todos os algoritmos acima (Douglas-Peucker, IDW, Marching Squares, shoelace) são implementados diretamente no projeto (arquivo `src/geo/`), sem dependências externas, já que optamos por vendorizar só o Leaflet.

## 8. Modelo de dados (IndexedDB)

Um único banco `PlantaTerraDB`, com as seguintes object stores:

### `projeto`
```
{
  id: uuid,
  nome: string,
  descricao: string,
  criado_em: timestamp,
  atualizado_em: timestamp
}
```

### `trilha_perimetro`
```
{
  id: uuid,
  projeto_id: uuid,
  pontos_brutos: [{ lat, lon, precisao, timestamp }, ...],
  poligono: [{ lat, lon }, ...],   // após simplificação e fechamento
  criado_em: timestamp,
  ativo: boolean   // permite manter histórico de re-mapeamentos, só um "ativo" por projeto
}
```

### `estacao_nivel`
```
{
  id: uuid,
  projeto_id: uuid,
  nome: string,                     // ex: "Estação 1"
  coordenada: { lat, lon, precisao },
  altura_instrumento: number,       // metros
  offset_altitude: number,          // calculado via ponto de amarração; 0 se é a estação-base
  amarrada_a_estacao_id: uuid | null,
  criado_em: timestamp
}
```

### `leitura_nivel`
```
{
  id: uuid,
  estacao_id: uuid,
  coordenada: { lat, lon, precisao },
  altura_mira: number,              // metros
  eh_ponto_amarracao: boolean,
  altitude_relativa: number,        // calculado = offset_estacao + altura_instrumento - altura_mira
  criado_em: timestamp
}
```

Camada de acesso: reaproveitar a ideia de `DBBase` do protótipo (uma pequena classe utilitária Promise-based sobre IndexedDB), mas reescrita — sem os métodos mortos/comentados que existiam no código antigo.

### Exportação/Importação

Botão "Exportar projeto" gera um único arquivo `.json` com todas as entidades acima filtradas por `projeto_id`, mais um `formato_versao` para permitir evolução do esquema. "Importar projeto" lê esse arquivo e recria os registros (novos UUIDs para evitar colisão, mas preservando os vínculos internos).

## 9. Estrutura de telas

1. **Lista de projetos** (tela inicial): criar novo projeto, abrir existente, importar de arquivo.
2. **Painel do projeto**: mapa Leaflet ocupando a maior parte da tela, com abas/botões flutuantes para alternar camadas (perímetro, estações+leituras, curvas de nível) e menu de ações:
   - "Mapear perímetro" → tela de captura de trilha (§6).
   - "Nova estação de nível" → formulário: capturar coordenada (§5) + altura do instrumento.
   - Dentro de uma estação ativa: "Nova leitura" → captura coordenada (§5) + altura da mira + checkbox "é ponto de amarração".
   - "Gerar curvas de nível" → roda o pipeline do §7 e desenha no mapa.
   - "Exportar" / "Excluir projeto".
3. **Tela de captura de coordenada** (componente reutilizado pelos fluxos acima): mostra indicador de qualidade do GPS, contagem de amostras, e permite confirmar ou tentar de novo.

## 10. Requisitos não funcionais

- **Offline-first**: service worker cacheia o app shell, o Leaflet vendorizado e os tiles de mapa já visitados. IndexedDB garante que os dados de campo nunca dependem de conexão.
- **Mobile-first / responsivo**: uso previsto é no navegador do celular, em campo, muitas vezes sob sol forte — botões grandes, alto contraste, mínimo de texto pequeno.
- **Privacidade**: nenhum dado sai do dispositivo a menos que o usuário exporte manualmente.
- **Resiliência a interrupção**: qualquer leitura em andamento pode ser retomada se o navegador for fechado/recarregado no meio (estado salvo incrementalmente, não só ao final).
- **Idioma**: pt-BR em toda a interface.

## 11. Fora de escopo / trabalho futuro

- Leitura automática da altura do laser via câmera (ideia explorada em `curvanivel_camera`, não descartada, mas não faz parte desta primeira versão).
- Sincronização em nuvem / múltiplos usuários no mesmo projeto.
- Exportação para formatos CAD (DXF/DWG) ou shapefile.
- Suavização avançada de curvas de nível (splines) além do que o Marching Squares produz.
- Cálculo de volume de terraplenagem/corte-aterro a partir do relevo.

## 12. Estrutura de pastas proposta (novo código)

```
app/                          # nova aplicação (código antigo permanece intocado em src/html como referência)
  index.html
  manifest.json
  sw.js
  css/
  js/
    main.js
    componentes/              # web components (custom elements), templates inline via <template>
    dominio/                  # Projeto, EstacaoNivel, Leitura, Trilha — entidades e regras (§4)
    geo/                      # douglas_peucker.js, idw.js, marching_squares.js, projecao.js, shoelace.js
    gps/                      # captador de coordenada estabilizada (§5), captador de trilha (§6)
    db/                       # camada IndexedDB
  vendor/
    leaflet/
docs/
  especificacao.md            # este arquivo
```

## 13. Plano de implementação incremental

1. Estrutura base do app (HTML/CSS/JS shell, PWA manifest, sem funcionalidade ainda).
2. Camada de dados (IndexedDB) + CRUD de projetos.
3. Captura de coordenada estabilizada (§5) como componente isolado e testável.
4. Fluxo de estação de nível + leituras + cálculo de altitude relativa (§4), sem mapa ainda (lista/tabela).
5. Integração do Leaflet (vendorizado) + exibição de pontos no mapa.
6. Captura de trilha de perímetro (§6) + desenho do polígono.
7. Pipeline de curvas de nível (§7): projeção, IDW, marching squares, desenho no mapa.
8. Exportação/Importação de projeto.
9. Service worker / instalação como PWA / cache de tiles.
10. Polimento de UI mobile (contraste, botões, feedback de GPS).
