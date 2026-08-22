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
2. App usa `watchPosition` continuamente. Cada amostra passa por dois filtros antes de virar ponto confirmado da trilha, para evitar saltos isolados de GPS (multipath, reflexo em construção/vegetação):
   - **Precisão**: amostras com `accuracy` pior que um limite configurável (padrão 20 m, mesmo padrão usado na captura de ponto único, §5) são descartadas — nem alimentam o marcador de posição atual, nem a trilha.
   - **Medóide em janela deslizante**: as amostras aceitas por precisão entram numa janela das últimas N amostras (padrão 3, configurável). A cada nova amostra, com a janela cheia, calcula-se o **medóide** — a amostra da janela cuja soma de distâncias até as outras é a menor — e esse é o ponto candidato. Um salto isolado fica longe das demais amostras da janela e nunca vence essa comparação; um deslocamento real (mesmo acelerando, a pé ou de carro) só precisa que a maioria das amostras recentes concorde entre si, sem depender de um limiar fixo de velocidade.
   - O candidato resultante só vira ponto confirmado da trilha se estiver a mais de uma distância mínima do último ponto confirmado (padrão 3 m, configurável) — a mesma decimação de sempre, agora alimentada pelo candidato filtrado em vez da amostra bruta.
   - Efeito colateral aceito: um pequeno atraso (poucos segundos, até a janela encher) entre o início da caminhada e o primeiro ponto confirmado, e entre cada amostra bruta e sua confirmação.
3. Mapa mostra a trilha sendo desenhada em tempo real (polyline no Leaflet), com a posição atual do usuário destacada (o marcador de posição atual usa a amostra bruta, já filtrada por precisão, sem esperar a janela — só a trilha registrada passa pelo filtro de medóide).
4. Usuário pode pausar/retomar (ex. parar para almoçar) e apagar o último ponto se caminhar por engano.
5. Ao apertar "Concluir perímetro": a trilha bruta passa por **simplificação (algoritmo de Douglas-Peucker)** para remover ruído mantendo a forma, e é fechada (conectando o último ponto ao primeiro) para virar um polígono — a menos que o projeto esteja marcado como "terreno convexo" (ver abaixo), caso em que o polígono é calculado por casco convexo.
6. O polígono resultante fica associado ao projeto e é exibido permanentemente sobre o mapa. Pode ser refeito a qualquer momento (gera uma nova trilha, substituindo ou salvando como versão). O histórico de rodadas (tela "Histórico de rodadas") lista todas as capturas já feitas, permite trocar qual está ativa, editar os pontos brutos de qualquer uma delas, excluí-la, ou **exportar o polígono daquela rodada isoladamente em KML** (`js/db/exportador_geoespacial.js#exportarKMLTrilha`) — diferente da exportação completa do projeto (§8), que sempre usa a rodada ativa.
7. Área do polígono (m² e hectares) é calculada e exibida (fórmula de área geodésica aproximada, ex. shoelace sobre projeção local equirretangular — suficiente para propriedades rurais de porte comum).

### 6.1 Fechamento por casco convexo (terrenos convexos)

Obstáculos na divisa (plantas, cercas, construções) podem forçar a pessoa a desviar para dentro do terreno em alguns trechos da caminhada. Para um terreno **convexo** (todos os ângulos internos < 180°, ex. um retângulo), isso não é um problema: como a pessoa nunca sai para fora da divisa real, os cantos verdadeiros do terreno continuam sendo os pontos mais extremos de tudo que foi capturado. Calcular o **casco convexo** (algoritmo de Andrew, "monotone chain", `js/geo/casco_convexo.js#calcularCascoConvexo`) do conjunto de pontos brutos reconstrói exatamente a divisa real, descartando automaticamente qualquer desvio para dentro — diferente da simplificação por Douglas-Peucker, que só simplifica a forma do caminho efetivamente andado (preservando os desvios).

Essa técnica **não é válida para terrenos com reentrâncias** (qualquer ângulo interno reflexo, > 180°, ex. um formato em L): o casco convexo preencheria a reentrância incorretamente, aumentando a área. Por isso é uma opção explícita, não o padrão.

Convexidade é uma característica do terreno, não de uma rodada de captura — por isso é uma configuração do **projeto** (`projeto.terreno_convexo`, ver §8), não uma escolha por rodada. Ao ligar ou desligar essa configuração, o polígono de **todas** as rodadas já salvas do projeto é recalculado e regravado na hora (com o método correspondente), não só as rodadas futuras. Uma rodada onde o resultado teria menos de 3 pontos é deixada como estava. O editor de pontos brutos de uma rodada já salva (acessível pelo histórico de rodadas) também usa esse método ao recalcular o polígono ao salvar, e mostra uma prévia tracejada do casco convexo candidato enquanto pontos são excluídos.

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
  terreno_convexo: boolean,   // ver secao 6.1 — fecha o perimetro por casco convexo em vez de Douglas-Peucker
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

Botão "Exportar projeto" gera um único arquivo `.json` com todas as entidades acima filtradas por `projeto_id`, mais um `formato_versao` para permitir evolução do esquema. "Importar projeto" lê esse arquivo e recria os registros (novos UUIDs para evitar colisão, mas preservando os vínculos internos). Esse é o formato de **backup fiel** (round-trip completo dentro do próprio PlantaTerra).

Além dele, o projeto pode ser exportado em **GeoJSON** e **KML/KMZ** para uso em outras ferramentas GIS (QGIS, Google Earth) — ver §14.4, que unifica esses formatos com os dados de SAF/linhas de plantio.

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
- **Versionamento visível**: o rodapé de todas as telas mostra a versão do app (`js/versao.js`, constante `VERSAO_APP`), para o usuário confirmar visualmente que uma atualização já chegou ao aparelho. Precisa ser incrementada a cada release **junto com** `VERSAO_APP`/`VERSAO_CACHE` em `sw.js` — é o bump do cache do service worker que faz o app shell realmente trocar de versão; sem isso o rodapé mentiria (mostraria a versão nova enquanto o cache ainda serve os arquivos antigos).

## 14. SAF (Sistemas Agroflorestais) e Linhas de Plantio

### 14.1 Motivação e contexto

O usuário já mantém, fora do PlantaTerra, um arquivo **KMZ** da propriedade (feito no Google Earth) com uma estrutura de pastas:

- Uma pasta cujo nome começa com **"SAF"** (Sistema Agroflorestal) por sistema/talhão, ex: `SAF 1`, `SAF Quintal`.
- Dentro dela, um `Placemark` de linha (`LineString`) por fileira de plantio, com nome começando com **"Linha"**, ex: `Linha 3 - Café - Sombreamento - 40m`.

Hoje, para saber o que está plantado em cada linha, o usuário usa um único PIN genérico no Google Earth — não há registro estruturado por metro da linha. O objetivo desta funcionalidade é:

1. **Importar** esse KMZ, reconhecendo esse padrão de pastas/linhas.
2. Permitir **dividir cada linha em segmentos de 1 metro** e registrar quais plantas existem em cada segmento.
3. **Exportar de volta** para KML/KMZ, agora com um marcador por metro plantado (mostrando as plantas ali) além da linha inteira — substituindo o PIN único genérico.
4. Fazer isso **usando o mesmo modelo geoespacial** do restante do app (mesmo `Projeto`, mesmo mapa Leaflet, mesmo exportador KML/GeoJSON), já que perímetro, curva de nível e linhas de plantio descrevem a mesma propriedade.

### 14.2 Conceitos de domínio

- **SAF**: um agrupamento de linhas de plantio dentro de um `Projeto` (equivalente a uma pasta no KMZ). Guarda nome e descrição; permite reimportar um KMZ atualizado sem duplicar (é resolvido por nome, não recriado a cada importação).
- **Linha de Plantio (`LinhaPlantio`)**: uma fileira de plantio, importada como `LineString` ou desenhada manualmente. Guarda a geometria (vértices lat/lon), o número da linha (se reconhecido no nome), uma descrição livre, e o **comprimento**. O comprimento **sempre é calculado a partir da geometria** (soma das distâncias entre vértices) — nunca confiado ao valor declarado no nome do placemark, que é mantido apenas como metadado informativo para conferência.
- **Segmento de 1 metro**: não é uma entidade persistida — é calculado sob demanda a partir da geometria da linha (ver §14.5), identificado por um índice inteiro (0-based) que representa o metro `[índice, índice+1)` ao longo da linha.
- **Planta em Linha (`PlantaLinha`)**: um registro de que existe (pelo menos) uma planta em um segmento específico de uma linha. Um mesmo segmento pode ter **múltiplas** `PlantaLinha` (consórcio/intercalação de espécies no mesmo ponto).

### 14.3 Reconhecimento do padrão ao importar

Regras de reconhecimento (tolerantes, para não travar em variações de nomenclatura):

- **Pasta = SAF** se o nome (após `trim()`) começar com `SAF` (case-insensitive), em qualquer profundidade da árvore de pastas do KML.
- **Placemark = Linha de Plantio** se o nome começar com `Linha` ou `Linhas` (case-insensitive, singular ou plural — ex: `"Linhas 6 - Círculo de bananeiras"`) **e** tiver geometria de linha (`LineString`) **ou** de polígono (`Polygon`), em qualquer profundidade dentro de uma pasta SAF reconhecida. Não é exigido que o resto do nome siga um padrão específico — o importador tenta extrair informação adicional, mas nunca deixa de importar por isso.
- **Linha desenhada como polígono (faixa com largura)**: é comum desenhar a linha de plantio já com a largura real do canteiro, virando um `Polygon` estreito no KML em vez de um `LineString`. Nesse caso o importador deriva a **linha central** (`js/geo/geodesia.js#centralizarFaixaPoligonal`) sem assumir nenhuma ordem específica de desenho dos vértices — pessoas/ferramentas diferentes desenham uma faixa de jeitos diferentes (ex: percorrendo um lado e voltando pelo outro, ou simplesmente contornando o retângulo canto a canto): (1) acha o eixo de maior variância dos vértices (PCA sobre um plano local), que é a direção "ao longo" da faixa seja qual for a ordem de desenho; (2) projeta cada vértice nesse eixo e ordena por essa projeção; (3) agrupa vértices consecutivos na ordem projetada dois a dois (cada par são os dois cantos da mesma "travessa") e usa o ponto médio de cada par como um ponto da linha central. Um vértice sobrando (número ímpar) vira um ponto sozinho (ex: ponta arredondada/pontuda).
- **Extração de número/descrição/comprimento declarado do nome**, com parser tolerante (`js/dominio/saf.js#parsearNomeLinha`):
  1. Remove o prefixo `Linha` (e separador opcional `-`/`:`).
  2. Se o que sobra começa com um número, esse é o `numero_linha`.
  3. Se o que sobra **termina** com um padrão tipo `40m`, `40 metros`, `40 metros lineares`, esse valor vira `metros_lineares_declarado` (apenas informativo).
  4. O que sobra no meio, sem os separadores `-` nas pontas, vira a `descricao` (pode ser vazia).
  5. Exemplo: `"Linha 3 - Café - Sombreamento - 40m"` → `numero_linha=3`, `descricao="Café - Sombreamento"`, `metros_lineares_declarado=40`.
- Uma pré-visualização é mostrada antes de gravar no banco, listando as SAFs e linhas reconhecidas (com o comprimento **recalculado** da geometria ao lado do declarado, para o usuário perceber discrepâncias) — a importação só é persistida após confirmação.
- Reimportar um KMZ atualizado faz **upsert**: SAF e Linha existentes (casadas por nome dentro do projeto/SAF) têm a geometria/descrição atualizadas em vez de duplicadas; as `PlantaLinha` já cadastradas são preservadas (ficam associadas ao mesmo `linha_id`).

### 14.4 Unificação do modelo geoespacial (KML/KMZ/GeoJSON)

Perímetro, curvas de nível e SAF/linhas de plantio descrevem a **mesma propriedade** e passam a ser exportados **juntos, no mesmo arquivo**:

- `js/db/exportador_geoespacial.js` monta um único conjunto de dados por projeto (perímetro + curvas de nível + SAFs/linhas + plantas) e gera três saídas a partir dele: **GeoJSON**, **KML** e **KMZ** (KML compactado em ZIP, formato que o usuário já usa).
- No KML/KMZ, a estrutura de pastas é preservada e re-gerável: uma pasta por SAF, contendo o `Placemark` de cada linha (`LineString`) e, para cada metro com planta cadastrada, um `Placemark` de ponto (`Point`) na posição interpolada daquele metro, com a lista de plantas na descrição — isso substitui o PIN único manual do fluxo atual do usuário.
- A importação (§14.3) é o caminho inverso: lê SAFs/linhas de um KML/KMZ. Também é tolerante a um KML já exportado pelo próprio PlantaTerra (reimportação/edição externa), já que a estrutura de pastas é a mesma.
- Perímetro e curvas de nível continuam sendo importados apenas pelo fluxo próprio do app (captura de GPS, §5–§7) — a leitura de polígono/curvas a partir de um KML externo não está no escopo desta fase.

### 14.5 Divisão de uma linha em segmentos de 1 metro

Algoritmo (`js/geo/segmentador_linha.js#dividirEmMetros`), reaproveitando a projeção local de `geodesia.js`:

1. Projeta os vértices da linha para um plano cartesiano local (metros), centrado no centróide da própria linha.
2. Caminha pelos vértices somando a distância acumulada, obtendo o comprimento total da linha.
3. Para cada marca inteira de metro (`0, 1, 2, ..., piso(comprimento_total)`), interpola a posição ao longo da polilinha (entre os dois vértices que cercam aquela distância acumulada) e reprojeta de volta para lat/lon.
4. Cada segmento `i` é o trecho entre a marca `i` e `i+1` (o último segmento pode ser mais curto que 1 m, se o comprimento não for múltiplo inteiro); guarda ponto inicial, final e médio (usado para desenhar o marcador no mapa).

### 14.5a Matriz de um SAF (alinhamento entre linhas, incluindo linhas divididas)

Ao abrir um SAF, em vez de precisar entrar linha por linha, o app mostra **todas as linhas de uma vez**, alinhadas entre si por posição geográfica real — uma matriz onde cada fileira é uma linha lógica e cada coluna é um metro. Isso é necessário porque é comum uma linha física ser desenhada como **duas (ou mais) `Placemark`s separados** por causa de um vão no meio (ex: um caminho cruzando o SAF) — no Recanto Caetano isso aparece como `"Linha 3 - Norte - 8,41m"` e `"Linha 3 - Sul - 6,25m"`, duas geometrias com o mesmo número de linha. A matriz precisa: (a) reconhecer que são a mesma fileira, e (b) alinhar as colunas de "Linha 3" com as de "Linha 2"/"Linha 4" considerando o vão real entre as partes.

Algoritmo (`js/geo/matriz_saf.js#calcularMatrizSaf`):

1. Reúne os pontos de geometria (já centralizada, ver §14.3) de **todas** as linhas do SAF e calcula um projetor local (`geodesia.js#criarProjetorLocal`) centrado no centróide de todos eles — um único plano cartesiano compartilhado por todo o SAF, não um por linha.
2. Calcula a **direção média das fileiras** (eixo "ao longo da linha", chamado `U`, e seu perpendicular "através das fileiras", `V`) usando uma média circular com ângulo dobrado (`2θ`) antes de calcular a média — isso evita que linhas desenhadas em sentidos opostos se cancelem ao somar vetores de direção (técnica padrão para dados axiais/não-direcionados).
3. Para cada linha, roda o mesmo `dividirEmMetros` (§14.5) já usado para a visualização de uma única linha — ou seja, o índice de metro (`indice_metro`) salvo em cada `PlantaLinha` **não muda**, garantindo compatibilidade com plantas já cadastradas.
4. Projeta o ponto médio de cada segmento nos eixos `U`/`V`, obtendo uma coordenada `u` (posição ao longo da fileira) por segmento.
5. `origem_u` = o menor `u` entre **todos** os segmentos de **todas** as linhas do SAF. A coluna global de um segmento é `piso((u_do_segmento - origem_u) / tamanho_do_segmento)` — como `origem_u` e os eixos `U`/`V` são os mesmos para todas as linhas, a coluna N de qualquer linha corresponde à mesma posição física da coluna N de qualquer outra.
6. Agrupa as linhas em **linhas lógicas** por `numero_linha` (linhas com o mesmo número, ex: "Norte" e "Sul", viram uma única fileira da matriz). Sem número reconhecido, cada `Placemark` vira sua própria fileira.
7. Dentro de uma fileira, colunas sem nenhum segmento de nenhuma parte ficam **em branco** — é exatamente aí que aparece o vão real entre "Norte" e "Sul", alinhado com as demais linhas.
8. As fileiras são ordenadas por `numero_linha` (as sem número vão por último).

Essa é uma aproximação geométrica (linhas raramente são perfeitamente paralelas/retas na vida real), então o alinhamento pode ocasionalmente errar por 1 coluna em pontas de linha — aceitável para o objetivo de visualizar e cadastrar plantas rapidamente, sem exigir precisão de CAD.

### 14.6 Fluxo de uso

1. No painel do projeto, seção **"Sistemas Agroflorestais"**: botão **"Importar KMZ/KML"** → seleciona arquivo → pré-visualização (§14.3) → confirma.
2. Lista de SAFs, cada uma mostrando quantas linhas e o comprimento total; abaixo do título da seção, um resumo menor com o total de linhas e metros lineares somando todos os SAFs do projeto.
3. Ao abrir um SAF, a interface mostra a **matriz completa** (§14.5a):
   - Todas as linhas do SAF destacadas no mapa de uma vez, com um marcador em cada metro que já tem planta cadastrada.
   - Uma **grade (matriz)** com uma fileira por linha lógica e uma coluna por metro, alinhadas entre si — linhas divididas (ex: "Linha 3" em duas partes) aparecem como uma única fileira, com o vão real em branco.
   - Tocar em um quadrado abre um diálogo de planta em formato **"bottom sheet"** (colado na parte de baixo da tela, sem escurecer o mapa, diferente dos demais diálogos do app) — lista as plantas já cadastradas naquele metro daquela linha específica (com opção de remover) e um formulário para adicionar uma nova (espécie/nome, quantidade opcional, observação opcional, data de plantio opcional). Ao abrir, o mapa centraliza (sem mudar o zoom) num marcador amarelo diferenciado exatamente nesse metro, para ficar claro onde ele fica dentro da linha — como o mapa continua visível, isso acontece no mesmo instante em que o diálogo abre, sem etapa extra.
4. Botão **"Exportar"** do projeto (mesmo menu do §8) passa a incluir a opção **KMZ completo**, contendo tudo (perímetro, curvas de nível, SAFs/linhas, plantas por metro).

### 14.7 Modelo de dados adicional

```
saf {
  id, projeto_id, nome, descricao,
  origem: "kmz_importado" | "manual",
  criado_em, atualizado_em
}

linha_plantio {
  id, saf_id, projeto_id,
  nome_original,                  // nome bruto do placemark, usado para casar em reimportações
  numero_linha: number | null,
  descricao: string,
  metros_lineares_declarado: number | null,   // apenas informativo, vindo do nome
  comprimento_calculado_m: number,            // autoritativo, calculado da geometria
  geometria: [{ lat, lon }, ...],
  origem: "kmz_importado" | "manual",
  criado_em, atualizado_em
}

planta_linha {
  id, linha_id,
  indice_metro: number,           // 0-based, segmento [indice, indice+1) da linha
  especie: string,
  quantidade: number | null,
  observacao: string | null,
  data_plantio: timestamp | null,
  criado_em
}

elemento_contexto {           // ver secao 14.8
  id, projeto_id,
  nome: string,
  tipo: "Point" | "LineString" | "Polygon",
  geometria: [{ lat, lon }, ...],
  caminho: string,            // trilha de pastas do KML de origem, ex: "Moradia e Edificações > Casa Sete Cores"
  origem: "kmz_importado",
  criado_em
}
```

### 14.8 Elementos de contexto e respeito à visibilidade do KML

Um KML/KMZ real de propriedade normalmente tem muito mais conteúdo do que só SAF/linhas de plantio: casas, cercas, ruas, rede elétrica, tubulação de irrigação, pontos de referência etc. Esse conteúdo ajuda a **situar** a propriedade no mapa, mesmo sem ser "dado agrícola" propriamente dito — então a importação (§14.3) também coleta esses elementos, com duas regras:

1. **Respeita a tag `<visibility>` do KML.** O Google Earth marca `<visibility>0</visibility>` em pastas/placemarks que a pessoa desligou (ex: métodos antigos de marcação, rascunhos, camadas de trabalho). Isso é herdado por toda a subárvore — se uma pasta está com `visibility=0`, todo o conteúdo dentro dela é ignorado, mesmo que os filhos não tenham a tag. Sem `<visibility>`, o padrão do KML é visível. Isso evita poluir o projeto com conteúdo que a própria pessoa já considerou obsoleto (`js/kml/leitor_kml.js`, que agora propaga um campo `visivel` por nó da árvore).
2. **Só entra o que não é SAF/Linha.** Qualquer `Placemark` com geometria (`Point`, `LineString` ou `Polygon`) que não seja uma pasta SAF reconhecida (§14.3) nem um placemark "Linha..." dentro dela vira um elemento de contexto — inclusive placemarks que estão dentro de uma pasta SAF mas não são linhas (ex: o polígono da área total do SAF, "Cerca Viva", "Gramado").

Elementos de contexto **não têm estado do usuário** (diferente de `linha_plantio`, que acumula `planta_linha` ao longo do tempo) — por isso uma reimportação simplesmente **substitui** todos os elementos de contexto do projeto (`plantaTerraDB.substituirElementosContexto`), sem lógica de upsert.

No mapa (`mapa_projeto.js#definirElementosContexto`), são desenhados em cinza neutro, por baixo de todas as outras camadas, sem interação — só para dar contexto visual. Na exportação (GeoJSON/KML/KMZ, §14.4), entram como uma pasta `"Contexto"` separada, mantendo o ciclo de importar → editar → exportar coerente com o resto do app.

## 15. Roadmap de fases futuras (fora de escopo desta implementação)

Estas fases reaproveitam `planta_linha` como núcleo, então são descritas aqui para guiar decisões de modelo de dados desde já (evitar retrabalho), mas **não fazem parte da implementação atual**:

- **Fotos por planta/data**: nova entidade `foto_planta { id, planta_linha_id, data, blob_ou_referencia, observacao }`, permitindo registrar a evolução de uma planta específica ao longo do tempo (galeria por `planta_linha_id`).
- **Biblioteca de plantas**: catálogo `especie { id, nome_popular, nome_cientifico, ciclo, espacamento_recomendado, notas }`, separado de texto livre. `planta_linha.especie` (string) evolui para `planta_linha.especie_id` (referência ao catálogo), mantendo o campo de texto livre como fallback para espécies ainda não cadastradas.
- **Horta**: um contexto de cultivo irmão de "Linha de Plantio", mas para canteiros (grade 2D em vez de segmentos ao longo de uma linha 1D). Deve compartilhar `planta_linha`/`especie`/`foto_planta` na medida do possível (ex: renomear o vínculo para uma entidade mais genérica `local_plantio` que tanto uma `LinhaPlantio` quanto um `Canteiro` possam implementar), para que fotos e biblioteca de plantas funcionem igual nos dois contextos.

## 16. Fora de escopo / trabalho futuro

- Leitura automática da altura do laser via câmera (ideia explorada em `curvanivel_camera`, não descartada, mas não faz parte desta primeira versão).
- Sincronização em nuvem / múltiplos usuários no mesmo projeto.
- Exportação para formatos CAD (DXF/DWG) ou shapefile.
- Suavização avançada de curvas de nível (splines) além do que o Marching Squares produz.
- Cálculo de volume de terraplenagem/corte-aterro a partir do relevo.
- Importação de perímetro/curvas de nível a partir de um KML externo (só o fluxo próprio de GPS faz isso — ver §14.4).
- Roadmap de plantas (fotos, biblioteca de espécies, horta) — ver §15.

## 17. Estrutura de pastas (código atual)

```
src/html/                     # aplicação (código antigo do protótipo foi removido)
  index.html
  manifest.json
  sw.js
  css/
  js/
    main.js
    componentes/              # web components (custom elements): mapa, captura GPS, painéis, editor de linha
    dominio/                  # regras de negócio: nivelamento.js (§4), saf.js (§14.3)
    geo/                      # geodesia.js, douglas_peucker.js, casco_convexo.js (§6.1), idw.js,
                               # marching_squares.js, curvas_de_nivel.js, segmentador_linha.js (§14.5)
    gps/                      # captador de coordenada estabilizada (§5), captador de trilha (§6)
    kml/                      # leitura/escrita de KML/KMZ (§14.3, §14.4)
    db/                       # camada IndexedDB + exportadores (backup, GeoJSON/KML/KMZ)
  vendor/
    leaflet/
    fflate/                   # zip/unzip para KMZ
docs/
  especificacao.md            # este arquivo
```

## 18. Plano de implementação incremental

1. Estrutura base do app (HTML/CSS/JS shell, PWA manifest, sem funcionalidade ainda).
2. Camada de dados (IndexedDB) + CRUD de projetos.
3. Captura de coordenada estabilizada (§5) como componente isolado e testável.
4. Fluxo de estação de nível + leituras + cálculo de altitude relativa (§4), sem mapa ainda (lista/tabela).
5. Integração do Leaflet (vendorizado) + exibição de pontos no mapa.
6. Captura de trilha de perímetro (§6) + desenho do polígono.
7. Pipeline de curvas de nível (§7): projeção, IDW, marching squares, desenho no mapa.
8. Exportação/Importação de projeto (backup JSON).
9. Service worker / instalação como PWA / cache de tiles.
10. Exportação GeoJSON/KML para GIS (§8, formatos além do backup).
11. Importação de KMZ/KML de SAF/linhas de plantio, segmentação em metros, cadastro de plantas por metro, e exportação unificada em KMZ (§14).
12. Polimento de UI mobile (contraste, botões, feedback de GPS).
