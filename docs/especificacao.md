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
| Bibliotecas de terceiros | **Vendorizadas** (baixadas e commitadas no repositório, ex. `vendor/openlayers/`), nunca via CDN — o app precisa abrir offline em campo. |
| Persistência | **Local-first**, IndexedDB no navegador. Sem backend. Exportação/Importação de projeto em arquivo (GeoJSON/JSON) para backup e transferência entre aparelhos. |
| Mapa base | **OpenLayers** (global `ol`, `vendor/openlayers/`) + tiles OpenStreetMap, com cache de tiles já visitados (para reabrir o mapa offline na mesma área). O mapa **gira** com dois dedos e tem botão de bússola para voltar ao norte; rótulos de texto desenhados por nós não giram junto (ficam legíveis), mas os nomes impressos nos tiles raster do OSM giram. Trocou do Leaflet porque ele não suporta rotação. |
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
3. Mapa mostra a trilha sendo desenhada em tempo real (linha vetorial no mapa), com a posição atual do usuário destacada (o marcador de posição atual usa a amostra bruta, já filtrada por precisão, sem esperar a janela — só a trilha registrada passa pelo filtro de medóide).
4. Usuário pode pausar/retomar (ex. parar para almoçar) e apagar o último ponto se caminhar por engano.
5. Ao apertar "Concluir perímetro": a trilha bruta passa por **simplificação (algoritmo de Douglas-Peucker)** para remover ruído mantendo a forma, e é fechada (conectando o último ponto ao primeiro) para virar um polígono — a menos que o projeto esteja marcado como "terreno convexo" (ver abaixo), caso em que o polígono é calculado por casco convexo.
6. O polígono resultante fica associado ao projeto e é exibido permanentemente sobre o mapa. Pode ser refeito a qualquer momento (gera uma nova trilha, substituindo ou salvando como versão). O histórico de rodadas (tela "Histórico de rodadas") lista todas as capturas já feitas, cada uma com nome editável (clique no lápis ✏️) e um checkbox "Visível no mapa" independente — **várias rodadas podem estar visíveis ao mesmo tempo**, cada uma desenhada com uma cor e rótulo diferentes (útil para áreas internas à propriedade, como uma horta, vistas junto com o perímetro total). A partir daí também dá para trocar qual rodada é a "principal" (usada no resumo de área do topo e na exportação completa do projeto, §8), editar os pontos brutos de qualquer rodada, excluí-la, ou **exportar o polígono daquela rodada isoladamente em KML** (`js/db/exportador_geoespacial.js#exportarKMLTrilha`).
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
4. **Reprojeção** das isolinhas de volta para lat/lon e desenho no mapa como linhas, uma cor por faixa de altitude (rótulo com o valor da curva).
5. Fora do polígono do perímetro (quando existir), as curvas são recortadas/ocultadas — não extrapolar visualmente para fora da propriedade.
6. Pontos de leitura brutos ficam disponíveis como uma camada que pode ser ligada/desligada (para conferência), assim como o rótulo de qual `EstacaoNivel` cada leitura pertence.

Todos os algoritmos acima (Douglas-Peucker, IDW, Marching Squares, shoelace) são implementados diretamente no projeto (arquivo `src/geo/`), sem dependências externas, já que optamos por vendorizar só a biblioteca de mapa (OpenLayers).

## 8. Modelo de dados (IndexedDB)

Um único banco `PlantaTerraDB`, com as seguintes object stores:

### `projeto`
```
{
  id: uuid,
  nome: string,
  descricao: string,
  terreno_convexo: boolean,   // ver secao 6.1 — fecha o perimetro por casco convexo em vez de Douglas-Peucker
  extensao_propriedade: { sul, oeste, norte, leste } | null,  // retangulo lat/lon com os pontos mais distantes (perimetros, estacoes, SAF, contexto); regravado quando o conteudo muda e usado para enquadrar a propriedade inteira (maior zoom em que cabe) ao abrir o projeto
  criado_em: timestamp,
  atualizado_em: timestamp
}
```

### `trilha_perimetro`
```
{
  id: uuid,
  projeto_id: uuid,
  nome: string | null,             // nome livre (ex: "Perímetro total", "Horta"); sem nome, usa a data da captura
  pontos_brutos: [{ lat, lon, precisao, timestamp }, ...],
  poligono: [{ lat, lon }, ...],   // após simplificação e fechamento
  criado_em: timestamp,
  ativo: boolean,   // o perímetro "principal" do projeto — usado no resumo de área do topo e na exportação
                     // completa (§8, §14.4); só um "ativo" por projeto
  visivel: boolean  // desenhado no mapa? vários registros podem estar visíveis ao mesmo tempo — não precisa
                     // ser o "ativo" (ex: a propriedade toda + uma área interna, como uma horta, juntas)
}
```

Diferente do campo `ativo` (histórico de re-mapeamentos de UM perímetro, só um por vez), `visivel` é independente por registro — permite ter vários perímetros nomeados desenhados juntos no mapa ao mesmo tempo (§9, tela "Histórico de rodadas"), útil para áreas internas à propriedade (uma horta, um curral) que não são "a divisa" mas fazem sentido ver junto com ela. Registros antigos sem o campo `visivel` são tratados como visíveis por padrão (`visivel !== false`).

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

Botão **"⭳ Backup"** na lista de projetos abre um diálogo para escolher **quais projetos** vão no arquivo (todos marcados por padrão; "Marcar/desmarcar todos"). Gera um único `.json` (`js/db/exportador_projeto.js#exportarBackup`):

```
{ formato: "plantaterra-backup", formato_versao: 1, exportado_em,
  projetos: [ { projeto, trilhas, estacoes: [{ estacao, leituras }],
                safs: [{ saf, linhas: [{ linha, plantas }] }], elementos_contexto } ],
  especies: [ instantâneo do registro da biblioteca ] }   // só as espécies que as plantas desses projetos usam
```

Cada projeto leva **todas** as suas entidades: perímetros (`trilha_perimetro`, com pontos brutos, `ativo` e `visivel`), estações e leituras, SAFs, linhas de plantio, plantas e elementos de contexto. O **menu "⋮"** do cabeçalho de um projeto (lista de itens, fecha com toque fora ou Esc) reúne: *Exportar* — backup do projeto (mesmo formato, só aquele projeto), GeoJSON, KML e KMZ completo; e *Importar* — **Backup** (.json; usa o importador universal, cria projeto novo sem sobrescrever o atual e, se veio um projeto só, oferece abri-lo) e **KMZ/KML** (mesmo fluxo com pré-visualização da vista SAF, §14.3, entrando neste projeto). **A biblioteca não vai inteira no backup** (§15.0): leva só um **instantâneo leve de cada espécie usada** (`especies`) — os campos compactos do táxon e a ficha **sem as fotos, só com a de capa**, sem relações nomenclaturais, referências do catálogo nem espécimes-tipo (`dominio/biblioteca_unificada.js#instantaneoParaBackup`; ~17 KB por espécie com ficha). Assim o backup fica enxuto e o projeto abre completo em outro aparelho, mesmo sem o catálogo importado.

O botão **"⭱ Importar"** aceita qualquer arquivo do PlantaTerra e descobre o tipo sozinho: backup completo, **projeto avulso de versões antigas** (sem campo `formato`, só perímetros e estações) ou **só fichas de biblioteca** (§15.0). Regras:
- **Nunca sobrescreve.** Projetos entram como novos, com novos UUIDs (os vínculos internos — amarração entre estações, linhas de um SAF, plantas de uma linha — são refeitos). Se já existe um projeto com o mesmo nome, o importado recebe o sufixo " (importado)"; ao restaurar num aparelho vazio, os nomes voltam como eram.
- **Espécies entram na biblioteca** (`db/biblioteca.js#incorporarInstantaneos`) *antes* dos projetos: o que falta é criado (mesmo sem o catálogo; quando o catálogo for importado depois, o registro se funde ao táxon pelo mesmo id); o que já existe fica como está (só ganha a ficha, se não tinha). `planta_linha.especie_id` é o id do registro e se mantém. **Backups antigos** (que levavam a biblioteca inteira, no formato de espécie, e `especie_nome_cientifico` em cada planta) ainda importam: as fichas vão para a biblioteca e as plantas se religam pela dupla popular + científico; planta sem correspondência fica só com o nome em texto.
- Arquivo inválido (JSON quebrado, formato desconhecido, projeto sem id/nome) é rejeitado com mensagem, sem importar nada parcialmente além do que já foi gravado antes do erro.

Este é o formato de **backup fiel** (round-trip completo dentro do próprio PlantaTerra). Como todo dado do usuário só existe no aparelho (§10), é a única garantia real contra perda.

Além dele, o projeto pode ser exportado em **GeoJSON** e **KML/KMZ** para uso em outras ferramentas GIS (QGIS, Google Earth) — ver §14.4, que unifica esses formatos com os dados de SAF/linhas de plantio.

## 9. Estrutura de telas

1. **Lista de projetos** (tela inicial): criar novo projeto, abrir existente, importar de arquivo, abrir a **Biblioteca de plantas** (§15.1, rota `#/biblioteca`).
2. **Painel do projeto**: mapa (OpenLayers) ocupando a maior parte da tela, com abas/botões flutuantes para alternar camadas (perímetro, estações+leituras, curvas de nível) e menu de ações:
   - "Mapear perímetro" → tela de captura de trilha (§6).
   - "Nova estação de nível" → formulário: capturar coordenada (§5) + altura do instrumento.
   - Dentro de uma estação ativa: "Nova leitura" → captura coordenada (§5) + altura da mira + checkbox "é ponto de amarração".
   - "Gerar curvas de nível" → roda o pipeline do §7 e desenha no mapa.
   - "Exportar" / "Excluir projeto".
3. **Tela de captura de coordenada** (componente reutilizado pelos fluxos acima): mostra indicador de qualidade do GPS, contagem de amostras, e permite confirmar ou tentar de novo.

## 10. Requisitos não funcionais

- **Offline-first**: service worker cacheia o app shell, o OpenLayers vendorizado e os tiles de mapa já visitados. IndexedDB garante que os dados de campo nunca dependem de conexão.
- **Mobile-first / responsivo**: uso previsto é no navegador do celular, em campo, muitas vezes sob sol forte — botões grandes, alto contraste, mínimo de texto pequeno.
- **Privacidade**: nenhum dado sai do dispositivo a menos que o usuário exporte manualmente.
- **Resiliência a interrupção**: qualquer leitura em andamento pode ser retomada se o navegador for fechado/recarregado no meio (estado salvo incrementalmente, não só ao final).
- **Proteção contra perda de dados no aparelho**: como todo dado do usuário só existe no IndexedDB do próprio aparelho, o app (1) pede **armazenamento persistente** ao abrir (`js/armazenamento.js#garantirArmazenamentoPersistente`, `navigator.storage.persist()`) — sem isso o navegador pode apagar o banco por falta de espaço ou, no iOS Safari, após ~7 dias sem uso; é só uma solicitação, o navegador decide (Chrome/Safari costumam conceder sozinhos para app instalado/de uso frequente, Firefox pergunta); e (2) avisa na tela quando o banco não consegue atualizar entre abas (`DBBase` dispara `"bloqueado"` — outra aba segura uma conexão antiga — e `"versao-alterada"` — outra aba atualizou o banco; esta fecha a conexão e pede recarregar), em vez de mostrar um app "vazio" sem explicação. Backup manual (exportar projeto, §8) continua sendo a única garantia real.
- **Idioma**: pt-BR em toda a interface.
- **Versionamento visível**: o rodapé de todas as telas mostra a versão do app (`js/versao.js`, constante `VERSAO_APP`), para o usuário confirmar visualmente que uma atualização já chegou ao aparelho. Precisa ser incrementada a cada release **junto com** `VERSAO_APP`/`VERSAO_CACHE` em `sw.js` — é o bump do cache do service worker que faz o app shell realmente trocar de versão; sem isso o rodapé mentiria (mostraria a versão nova enquanto o cache ainda serve os arquivos antigos).

## 11. Apoio ao projeto (Pix) e feedback (WhatsApp)

Inspirado no mesmo mecanismo já usado no projeto irmão (Nosso Treino): dois links discretos no rodapé, presentes em toda tela do app, sem popup nem gatilho — decisão explícita, diferente do banner pós-uso do outro projeto, porque o PlantaTerra não tem um "momento de conclusão" natural (não é uma sessão de treino).

### 11.1 "❤️ Apoiar" — painel de apoio via Pix

Link pro roteador interno (`#/apoiar`, `js/componentes/tela_apoiar.js`), sempre visível no rodapé (`js/main.js`). Mesma filosofia do Nosso Treino: o código só **exibe** strings "Pix copia e cola" já prontas, geradas no app do banco/PSP — nunca constrói ou calcula o payload (um payload Pix errado falha na validação de quem for pagar, não é algo pra reinventar).

- `js/dados_apoio.js` (`OPCOES_PIX`): lista de `{ valor, payload }` — um valor sugerido por opção, mais uma de valor livre (`valor: null`). `payload: null` esconde a opção até existir a string real. **Hoje todos os `payload` são `null` (placeholder, TODO)** — preencher com as strings reais antes de divulgar o link.
- QR Code gerado no navegador a partir do payload selecionado, biblioteca vendorizada (`vendor/qrcode/qrcode.min.js`, `davidshimjs/qrcodejs`, MIT — mesmo padrão de `vendor/openlayers/`, nunca CDN).
- Botão de copiar (`navigator.clipboard.writeText`, com fallback pra um `<input readonly>` selecionável se a Clipboard API não estiver disponível — nunca falha silenciosamente).
- Sem nenhuma opção com `payload` preenchido, mostra "Chave Pix ainda sendo configurada" em vez de uma tela quebrada.

### 11.2 "💬 Relatar" — feedback via WhatsApp

Link direto (`<a href="https://wa.me/...">`, sem JS necessário pra abrir) com uma mensagem pré-preenchida, que a pessoa revisa/completa antes de enviar — sem backend, sem formulário. `js/feedback_whatsapp.js` monta a mensagem e a URL. **Número de WhatsApp ainda é um placeholder (`NUMERO_WHATSAPP_FEEDBACK`, TODO)** — configurar antes de divulgar (formato E.164 sem `+`/espaço/traço, exigido por `wa.me`).

Diferente do Nosso Treino (que tem um botão de crítica por item da biblioteca, com uma tag `[ref:...]` na mensagem pra rastrear qual item), o PlantaTerra não tem uma "biblioteca" de itens individuais — por isso é um único ponto de acesso genérico no rodapé, sem categoria nem tag de referência. Se o projeto ganhar algo equivalente a uma biblioteca no futuro (ex: catálogo de espécies, §15), vale reconsiderar o padrão por-item.

### 11.3 Landing page (raiz do repositório)

`index.html` **na raiz do repositório** (irmão de `src/`, `docs/`) — página institucional separada do app, inspirada na mesma página do Nosso Treino: objetivo, princípios, painel de apoio, "quem faz", link pro código, privacidade. Diferente das demais páginas do projeto, não é uma PWA nem tem `manifest.json`/service worker próprios — é uma página estática simples, com seu próprio `<style>` inline (não compartilha `src/html/css/estilo.css`, que tem muito CSS específico do app que não se aplica aqui).

- Botão principal "Abrir o PlantaTerra" leva pra `./src/html/` (o app de verdade). O service worker do app é registrado a partir de `src/html/js/main.js` com escopo `src/html/` — não controla nem tenta cachear a landing page, escopos diferentes, sem conflito.
- O painel de apoio via Pix é **o mesmo módulo compartilhado** do app (`src/html/js/apoio_pix.js`, usado também por `<tela-apoiar>`) — evita duplicar a lógica de QR Code/cópia em dois lugares. A landing importa esse módulo e os outros compartilhados (`feedback_whatsapp.js`, `consentimento_analytics.js`) por caminho relativo (`./src/html/js/...`).
- Também mostra o banner de consentimento de analytics (§12) — é a página raiz do domínio, então precisa ser medida como qualquer outra.
- Não entra no precache do service worker do app (fora do escopo dele); é servida normalmente pelo GitHub Pages a cada visita.

## 12. Analytics de uso (Google Analytics, opt-in)

Mesma estratégia já usada e validada no projeto irmão (Nosso Treino), replicada aqui: saber quantas pessoas usam o PlantaTerra e quais telas usam mais, **sem** abrir mão da promessa de que dado de domínio (projetos, perímetros, pontos, curvas de nível — tudo no IndexedDB do aparelho) nunca sai do dispositivo. São dois mecanismos completamente separados; um nunca alimenta o outro.

- **Coletado, só com autorização**: pageview padrão do GA4 (`gtag.js`) — qual tela foi aberta, referência de origem, tipo de dispositivo. Sem eventos customizados por enquanto (ex: "perímetro capturado").
- **Nunca coletado**, com ou sem autorização: nome/dados de projeto, perímetro, pontos, curvas de nível — nenhum conteúdo do IndexedDB é passado ao script do GA em nenhum lugar do código.
- **Consentimento em `localStorage` puro** (`js/consentimento_analytics.js`, chave `plantaTerraConsentimentoAnalytics`, valores `"aceito"`/`"recusado"`) — **primeiro e único uso de `localStorage` no projeto** (todo o resto do dado do usuário é IndexedDB, ver §8). Fica fora do IndexedDB de propósito: é preferência de navegador, não dado de domínio, não precisa de migração de esquema nem de esperar a hidratação do banco.
- **Nenhuma resposta ainda**: banner fixo não bloqueante (`.analytics-banner`) aparece assim que o app carrega, em qualquer tela — o app funciona normalmente mesmo sem responder. "Aceitar" grava o consentimento e injeta o `gtag.js` do Google. "Recusar" grava e não carrega nenhum script do Google — nenhuma requisição sai pra domínio do Google antes do aceite. Resposta já dada: banner não aparece mais, em nenhuma tela, até a pessoa limpar os dados do navegador (sem tela de "mudar de ideia" por enquanto).
- **Sem Consent Mode do Google** (que carregaria o `gtag.js` sempre, com pings "cookieless" antes mesmo da resposta) — decisão deliberada: nenhum script do Google é carregado, nenhuma requisição sai, até o clique em "Aceitar".
- `MEASUREMENT_ID` em `js/consentimento_analytics.js` aponta pra propriedade GA4 "Planta Terra" (fluxo web `https://bonafe.github.io/plantaterra/`, código de fluxo `15489380468`, ID de métrica `G-JR0X3JBSER`).
- `js/consentimento_analytics.js` entra no precache do service worker como qualquer outro módulo local; o script externo do Google (`googletagmanager.com`) não é precacheado — `sw.js` só intercepta GET de mesma origem, então offline a chamada ao GA falha silenciosamente sem quebrar a tela.

## 14. SAF (Sistemas Agroflorestais) e Linhas de Plantio

### 14.1 Motivação e contexto

O usuário já mantém, fora do PlantaTerra, um arquivo **KMZ** da propriedade (feito no Google Earth) com uma estrutura de pastas:

- Uma pasta cujo nome começa com **"SAF"** (Sistema Agroflorestal) por sistema/talhão, ex: `SAF 1`, `SAF Quintal`.
- Dentro dela, um `Placemark` de linha (`LineString`) por fileira de plantio, com nome começando com **"Linha"**, ex: `Linha 3 - Café - Sombreamento - 40m`.

Hoje, para saber o que está plantado em cada linha, o usuário usa um único PIN genérico no Google Earth — não há registro estruturado por metro da linha. O objetivo desta funcionalidade é:

1. **Importar** esse KMZ, reconhecendo esse padrão de pastas/linhas.
2. Permitir **dividir cada linha em segmentos de 1 metro** e registrar quais plantas existem em cada segmento.
3. **Exportar de volta** para KML/KMZ, agora com um marcador por metro plantado (mostrando as plantas ali) além da linha inteira — substituindo o PIN único genérico.
4. Fazer isso **usando o mesmo modelo geoespacial** do restante do app (mesmo `Projeto`, mesmo mapa, mesmo exportador KML/GeoJSON), já que perímetro, curva de nível e linhas de plantio descrevem a mesma propriedade.

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
   - Tocar em um quadrado abre um diálogo de planta em formato **"bottom sheet"** (colado na parte de baixo da tela, sem escurecer o mapa, diferente dos demais diálogos do app) — mostra primeiro a **lista de plantas do metro em cards** (espaço para foto — hoje um 🌱 de placeholder, as fotos são do roadmap §15 —, nome popular, nome científico embaixo quando a espécie está na biblioteca, idade a partir da data de plantio — "plantada há 3 meses", "há 1 ano e 2 meses" —, quantidade/observação e a lixeira para remover); o formulário (espécie/nome, quantidade, **sementes plantadas**, observação, data de plantio, todos opcionais menos o nome) só aparece ao tocar em **"+ Adicionar planta"**. **Tocar no card de uma planta já adicionada abre o formulário preenchido para editá-la** ("Salvar alterações"; dá para esvaziar campos). **Adicionar a mesma espécie num metro que já a tem pergunta** (aviso no próprio formulário, `dominio/saf.js#acharPlantaIgual`: mesmo `especie_id` ou mesmo nome sem caixa/acento): **"É uma nova"** (outro plantio, ex.: no ano seguinte, com dados próprios — cria um registro novo), **"Atualizar a existente"** (só os campos preenchidos substituem os da planta que já está; em branco mantém — `aplicarDadosNaPlanta`) ou **"Voltar"** ao formulário. Ao abrir, o mapa centraliza (sem mudar o zoom) num marcador amarelo diferenciado exatamente nesse metro, para ficar claro onde ele fica dentro da linha — como o mapa continua visível, isso acontece no mesmo instante em que o diálogo abre, sem etapa extra.
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
  especie: string,                // nome em texto, sempre preenchido (fallback e exibição)
  especie_id: string | null,      // vínculo opcional com o registro da biblioteca (id do store `catalogo`, §15.0); sem vínculo vale o nome em texto
  quantidade: number | null,
  sementes: number | null,        // sementes plantadas (opcional); registros antigos não têm
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

### 14.9 Modo "Andar" na vista SAF (GPS guia a matriz)

O "Andar" não é mais uma tela de mapa cheio: é um **modo da vista SAF** (§14.10). A matriz de fileiras (§14.5a) continua sendo a protagonista; o mapa é só uma janela de conferência.

- **Layout:** mapa pequeno em cima (≈24% da altura, mínimo 150 px) com botão "⤢/⤡" para ampliar (≈62%) e voltar; embaixo, seletor de SAF (chips, só se há mais de um) e a matriz do SAF atual ocupando o resto da tela, com rolagem própria. No modo Andar as células crescem para 44 px. **A matriz tem cabeçalho de metros** (números 0, 1, 2… no topo, canto "metro") e o nome da fileira à esquerda, os dois fixos ao rolar (`position: sticky`, fundo opaco e `z-index` em camadas; **a grade tem `width: max-content`** — `sticky` só fica fixo dentro do bloco da grade, e numa grade com a largura da tela o rótulo saía junto com o bloco depois de ~240 px de rolagem horizontal, o que fazia o nome da fileira "sumir"). O número da coluna é a distância em metros desde a ponta esquerda da matriz (as fileiras são alinhadas geograficamente, §14.5a): para uma fileira que começa na ponta é o mesmo "metro N" do diálogo; uma que começa adiante difere pelo recuo. A célula tocada fica com contorno marcado e, no modo Andar, a coluna e a fileira do metro mais próximo acendem no cabeçalho. **Só a matriz encolhe/rola** (todo o resto da vista tem `flex: 0 0 auto`) e a vista é compacta de propósito — sem título (o importar KMZ/KML vive no menu ⋮), abas de 40 px, seletor de SAF sem barra de rolagem, faixa do GPS em 1–2 linhas —, porque num celular com a faixa e a bússola ligadas a matriz chegou a ficar com 4 px de altura.
- **Abas "Atual" | "📍 Andar".** "Atual" é só a matriz. "📍 Andar" liga o GPS (`watchPosition`, `enableHighAccuracy`, direto — sem a estabilização do §5) e mostra uma faixa de estado. Voltar a "Atual" desliga GPS e giro.
- **O GPS guia:** a cada posição, marca na matriz os metros dentro do raio de busca (`geo/proximidade_metros.js`, raio 3–12 m conforme a precisão; borda azul) e o mais próximo (amarelo); se a pessoa está a ≤ 25 m de alguma fileira, **troca sozinho para o SAF dela e rola a matriz** até centralizar o metro mais próximo. Mais longe que isso a faixa avisa a distância e nada rola. Acima de 15 m de imprecisão avisa "sinal fraco".
- **A pessoa pode pegar o controle:** tocar/rolar a matriz, trocar de SAF, tocar numa célula ou arrastar o mapa pausa a guia (a faixa fica amarela: "Você está no controle") — as marcações continuam atualizando, mas nada rola nem troca. "🎯 Voltar a seguir" retoma na hora.
- **Tocar numa célula** (em qualquer modo) abre o diálogo de planta (§14.6) e leva o mapa àquele metro: marcador amarelo com o rótulo **"SAF · Linha X · metro N"** e zoom mínimo 21 (nunca afasta), para a pessoa se situar no campo. É o **modo foco**: o mapa **mantém o tamanho** da vista SAF (≈24% da altura, para sobrar espaço aos dados da planta), a matriz some e o painel de plantas ocupa o resto da tela, **sem cobrir o mapa** (o `<dialogo-planta-metro>` é não modal — `show()`, no fluxo da tela, não `showModal()`); a seta **"←"** do cabeçalho do projeto (o painel não tem cabeçalho nem título próprios; quem situa a pessoa são as migalhas, abaixo) devolve o layout normal (e, se o GPS estava guiando, a matriz volta rolada para o metro mais próximo). A célula tocada fica com contorno marcado. Metros próximos também aparecem como bolinhas no mapa; tocar numa abre o mesmo diálogo.
- **Mapa:** ponto azul com círculo de precisão; primeiro sinal aproxima ao zoom 21; depois vale o zoom da pessoa. Adicionar planta não reenquadra o mapa.
- **"🧭 Girar com você" (frente para cima)** — botão 🧭 de 44 px na faixa do Andar, desligado por padrão; aceso (azul) quando ligado. O texto de explicação só aparece quando falta bússola ou enquanto ela é procurada.
  - **Fonte do rumo:** bússola do aparelho (`gps/captador_rumo.js`, `DeviceOrientation`; Android `deviceorientationabsolute`; iOS pede permissão dentro do toque do botão). Rumo com compensação de inclinação (`geo/rumo.js#calcularRumoBussola`) e da tela girada.
  - **Reserva:** sem bússola, `coords.heading` do GPS, só acima de 0,7 m/s.
  - **Suavização:** média exponencial de ângulos pelo caminho mais curto, no máximo 10 giros/s, ignorando < 2°. A bússola erra 10°–20° perto de ferro/motores.
  - Ligado, o giro com os dedos e a bússola de "voltar ao norte" ficam desativados; ao desligar, volta ao norte.
- Deixar a tela do projeto também desliga GPS e giro.

### 14.10 Estrutura do projeto: entrada, vistas e último lugar

Ao abrir um projeto, a tela de entrada mostra o **mapa da propriedade inteira** (perímetro, estações, linhas de SAF, elementos de contexto importados) e **três cartões** com resumo: Perímetro, Estações de nível (inclui curvas de nível) e Sistemas Agroflorestais. Cada um abre sua **vista**; "←" numa vista volta à entrada, e na entrada volta à lista de projetos.

- A vista SAF contém "Importar KMZ/KML", as abas Atual/Andar (§14.9), o seletor de SAF e a matriz.
- **Último lugar:** `localStorage["plantaterra:ultimo-lugar"]` guarda `{projetoId, vista, safId}`. Ao abrir o app (não a cada volta à lista) ele vai direto a esse projeto e vista, e ao SAF que estava aberto; "←" na entrada de um projeto apaga a memória. O Andar nunca reinicia sozinho (o GPS só liga por toque).

### 14.11 Componentes da vista SAF (contrato)

A vista SAF é composta por componentes independentes, ligados pelo `painel_projeto.js`. Eles não importam banco nem mapa, e não se conhecem — para poderem ser reaproveitados (a intenção é virarem componentes do UltimaJS).

- **`<matriz-saf>`** (`componentes/matriz_saf.js`): entrada `definir({matriz, plantasPorLinha})`, `limpar()`, `marcarProximos(chaves, chaveMaisProximo)`, `rolarPara(chave)`, `modoAndar`; eventos `metro-tocado {linhaId, indiceMetro, coordenada}` e `controle-assumido`.
- **`<andar-gps>`** (`componentes/andar_gps.js`): entrada `quadrados`, `iniciar()`, `parar()`, `assumirControle()`, `ativo`, `seguindo`; eventos `posicao {posicao, proximos, maisProximo, distanciaM, seguindo, atuando, centralizar, primeiroSinal}`, `rumo {graus}` e `rumo-ativo {ativo}`.
- **`<campo-limpavel>`** (`componentes/campo_limpavel.js`): envolve um `<input>` de texto e mostra o botão **"Limpar"** enquanto houver texto (esvazia, dispara `input` e devolve o foco). **Toda busca/filtro por texto do app usa ele** — hoje a busca da biblioteca e o campo de espécie do painel de plantas.
- **`<card-planta>`** (`componentes/card_planta.js`): card de planta/espécie — espaço para foto (🌱 sem imagem), nome popular, científico embaixo, linhas de detalhe e botões de ação. Entrada `dados = { nome, cientifico?, linhas?, foto?, acoes?: [{acao, icone, rotulo}] }` (propriedade ou atributo JSON); evento `acao-card {acao}` (borbulha). Usado no painel de plantas do metro e na biblioteca (§15.1). **Requisitos para criar telas:** reaproveitar componentes existentes antes de criar HTML novo, e usar **container queries** (não só media queries) para que o componente se adapte à largura do próprio contêiner — o card ganha foto e fontes maiores em colunas largas, e as listas de cards são grades `auto-fill` que viram várias colunas em telas grandes.
- **`<dialogo-planta-metro>`** (`componentes/dialogo_planta_metro.js`): painel não modal das plantas de um metro (§14.6; o layout do modo foco é do painel do projeto, §14.9). Entrada `buscarEspecies(texto)` (função injetada: busca na biblioteca para o autocomplete, §15.1) e `abrir({titulo, plantas, especies})` (`especies`: Map id → espécie das plantas listadas, para a capa e o nome científico dos cards; já aberto, só atualiza), `fechar()`, `aberto`; eventos `planta-adicionada {especie, especieId, quantidade, sementes, observacao, dataPlantio}` (`especieId` = id do registro da biblioteca; a máscara/validação da data dd/mm/aaaa é do diálogo) `planta-atualizada`, `planta-removida {id}` e `fechado`. Banco e recarga ficam em `painel_projeto.js#_wireDialogoPlanta`.
- **`<editor-pontos-trilha>`** (`componentes/editor_pontos_trilha.js`): painel do editor de pontos brutos de uma rodada do perímetro (§6). Guarda os pontos em edição, o selecionado e se houve alteração; entrada `abrir({pontos})`, `selecionarPonto(indice)`, `fechar()`, `aberto`; eventos `pontos-mudaram {pontos, indiceSelecionado, tMin, tMax, primeira}` (redesenhar no mapa), `salvar-solicitado {pontos}` (validar o polígono e gravar; depois `fechar()`) e `fechado`. Pedir confirmação ao descartar alterações é dele; mapa, validação e banco ficam em `painel_projeto.js#_wireEditorPontosTrilha`.
- **`<dialogo-historico-perimetro>`** (`componentes/dialogo_historico_perimetro.js`): histórico de rodadas do perímetro (§6). Entrada `rodadas` (trilhas; ordena por mais recente), `abrir()`, `fechar()`, `aberto`; eventos com o id da rodada: `definir-principal`, `excluir-rodada` (já confirmado), `editar-pontos`, `exportar-kml`, `renomear-rodada {id, nome}` e `visibilidade-alterada {id, visivel}`. O renomear inline (Enter confirma, Esc cancela, sair do campo confirma) é dele; banco, editor de pontos, exportação e recarga ficam em `painel_projeto.js#_wireHistoricoPerimetro`.
- **`<dialogo-importar-saf>`** (`componentes/dialogo_importar_saf.js`): pré-visualização da importação de KML/KMZ (§14.3, §14.8). Entrada `abrir({safsEncontradas, elementosContexto, avisos})` (o resultado de `analisarArquivoParaImportacao`), `fechar()`, `aberto`; evento `importacao-confirmada {safsEncontradas, elementosContexto}`. Ler o arquivo e gravar (`importarParaProjeto`) ficam em `painel_projeto.js#_wireSaf`.
- **Estações e leituras (§4):** `<dialogo-estacao>` (`abrir({estacoesParaAmarrar})`, evento `estacao-criada {nome, coordenada, alturaInstrumento, amarradaAEstacaoId}`), `<dialogo-leitura>` (`abrir()`, evento `leitura-criada {coordenada, alturaMira, ehPontoAmarracao}`), `<lista-estacoes>` (`estacoes = [{estacao, leituras}]`, evento `nova-leitura-solicitada {estacaoId}`) e o auxiliar `<campo-coordenada>` (linha "status + Capturar posição GPS"; recebe uma função `capturador` — o painel passa `<captura-gps>.abrir()` — e emite `coordenada-capturada`). Gravar a estação/leitura, resolver a amarração e recalcular altitudes (`painel_projeto.js#_salvarNovaLeitura`, regra do §4) continua no painel.
- Quem orquestra (`painel_projeto.js#_wireVistaSaf`) traduz eventos em ações no mapa, na matriz e na escolha do SAF.

### 14.12 Migração para o UltimaJS (etapa 2, em andamento)

O núcleo do UltimaJS (`component_base.js`, `reactive_component.js`, `controller_base.js`) está vendorizado em `src/html/vendor/ultima/` (cópia; mudanças vão para o repositório `ultima`). Os componentes do §14.11 estão sendo trocados, um a um, de `HTMLElement` puro para `ReactiveComponent`, **sem mudar o contrato** (propriedades/métodos de entrada e eventos de saída).

- **Migrados:** `<campo-coordenada>` (piloto), `<lista-estacoes>`, `<dialogo-estacao>`, `<dialogo-leitura>` e `<dialogo-planta-metro>` (lista de plantas e sugestões da biblioteca reativas; máscara da data via `data-on="input"`).
- **Como migrar um componente:** o HTML vai para um arquivo `.html` ao lado do `.js` (template com `{{ caminho }}`, `data-on`, `data-bind`, `data-if`, `data-for`); a classe estende `ReactiveComponent` com `super({ templateUrl, shadowDom: false }, import.meta.url)`; o estado reativo fica em `this.state`.
- **`shadowDom: false` sempre** — Shadow DOM isolaria o componente do `css/estilo.css` único do app.
- **O template carrega de forma assíncrona** (`fetch`): o `.html` precisa estar em `ARQUIVOS_DO_APP` do `sw.js` (senão quebra offline), e o componente só renderiza quando `loaded`. Estado definido antes do carregamento fica guardado e é aplicado depois — por isso os métodos de entrada (`limpar()`, etc.) podem ser chamados logo após a criação.
- **Não definir estado no construtor** (`createElement` não admite atributos ali, e o estado é espelhado no atributo `data-state`): inicialize em `connectedCallback`.
- **O template só interpola caminhos** (`{{ a.b }}`), sem expressões nem formatação: o texto já vai pronto no estado (ex.: `<lista-estacoes>` guarda `alturaInstrumento: "1.5 m"`). A interpolação vira texto, não HTML — não precisa de `escaparHtml`.
- **Listas:** `data-for="e in itens : id"` com chave (`: id`) reaproveita os nós entre renders — blocos `<details>` abertos continuam abertos quando a lista atualiza, o que o `innerHTML` antigo não conseguia. Listas aninhadas (`l in e.leituras`) e `<option>` dinâmicos (`data-bind='{"value":"e.id"}'`) funcionam.
- **Métodos de entrada assíncronos:** `abrir()` dos diálogos agora é `async` e espera `whenLoaded()`, porque o template pode ainda não ter chegado; quem chama não precisa esperar. Referências a elementos do template (`querySelector`) só em `onLoad()`.
- O estado vira JSON no atributo `data-state` do elemento: não guardar nele objetos grandes nem funções (ex.: o `capturador` continua propriedade comum).

## 15. Roadmap de fases futuras (fora de escopo desta implementação)

Estas fases reaproveitam `planta_linha` como núcleo, então são descritas aqui para guiar decisões de modelo de dados desde já (evitar retrabalho), mas **não fazem parte da implementação atual**:

- **Fotos por planta/data**: nova entidade `foto_planta { id, planta_linha_id, data, blob_ou_referencia, observacao }`, permitindo registrar a evolução de uma planta específica ao longo do tempo (galeria por `planta_linha_id`).
- ~~**Biblioteca de plantas**~~ — implementada, ver §15.1.
- **Horta**: um contexto de cultivo irmão de "Linha de Plantio", mas para canteiros (grade 2D em vez de segmentos ao longo de uma linha 1D). Deve compartilhar `planta_linha`/`especie`/`foto_planta` na medida do possível (ex: renomear o vínculo para uma entidade mais genérica `local_plantio` que tanto uma `LinhaPlantio` quanto um `Canteiro` possam implementar), para que fotos e biblioteca de plantas funcionem igual nos dois contextos.

### 15.0 Modelo único da biblioteca (implementado, v71)

**Há uma biblioteca só**: o catálogo nacional (§15.2). Cada registro do store `catalogo` é um táxon e, quando a espécie tem **dados ricos**, carrega também uma **`ficha`** (altura, funções, estrato, fotos, referências, textos… — §15.1/§15.3). Não existe mais "Minhas plantas" separada: o que era a biblioteca pessoal virou **fichas** nos registros do catálogo (ou **registros próprios**, com id próprio, quando a espécie não tem correspondência — as que a pessoa cria e as sete da Embrapa cujo nome do livro não casa com o JBRJ).

```
registro { id, c, a, k, st, r, f, p[], …campos compactos do táxon (§15.2), cn, nv, busca[],
           ficha?:        formato de espécie (§15.1)        rica?: 1  (índice `index_rica`)
           propria?: 1    sem correspondência no catálogo   sem_cientifico?: 1
           ficha_editada?: 1  a pessoa mexeu na ficha       ficha_origem?  arquivo de onde veio
           p_original?    nomes populares do catálogo, antes de somar os da ficha }
```

- **A planta do projeto aponta para o registro** (`planta_linha.especie_id`); o **projeto leva só as espécies que usa** (instantâneo leve no backup, §8). Quem tem ficha aparece primeiro na lista; o resto do catálogo vem depois, paginado.
- **Importar fichas** (`db/biblioteca.js#mesclarFichas`): cada ficha vai para o registro correspondente — pelo id do catálogo (`catalogo_id`), senão pelo nome científico (sinônimo → aceito); sem correspondência, vira registro próprio (se o id for do JBRJ e o catálogo ainda não foi importado, um registro provisório com esse id, que o catálogo completa depois). **A ficha importada de um arquivo substitui a que veio do mesmo arquivo** (reimportar atualiza fotos e textos) **e só completa o que falta** numa ficha de outro arquivo ou **editada pela pessoa** (`ficha_editada`). Por isso a ordem dos arquivos importa (§15.3), e o resumo diz quantas foram adicionadas, atualizadas, complementadas ou mantidas.
- **Importar o catálogo** (`.jsonl.gz`) **preserva as fichas**: o registro novo do táxon herda a ficha do antigo; fichas próprias importadas antes do catálogo, com o mesmo nome científico de um táxon, são fundidas nele e as plantas dos projetos se religam (`reconciliarPropriasComCatalogo`).
- **Criar/editar** (`✏️` na ficha, ou "+ Nova espécie"): o formulário cobre nome popular, outros nomes, forma de vida, altura, estrato, luz, funções, ciclo, espaçamento e notas; o nome científico de um táxon do catálogo não se edita. "Nova espécie" com um nome científico que já existe no catálogo **cria a ficha nesse táxon** (não duplica). Editar marca `ficha_editada`. `🗑` remove só a **ficha** (o táxon continua no catálogo); numa espécie própria, exclui o registro (plantas já cadastradas continuam com o nome em texto).
- **Limpar** (botão "Limpar", com confirmação): **só as fichas** (`removerTodasAsFichas`: cada táxon perde a dele e continua no catálogo; espécie própria é excluída) ou **tudo** (fichas e catálogo, `limparCatalogo`; leva alguns segundos e mostra progresso). Os projetos não são tocados: as plantas guardam o nome em texto e o `especie_id` que sobra aponta para nada.
- **Exportar** (botão "Exportar"): **Fichas completas** (`plantaterra-fichas-<data>.json`, formato `plantaterra-biblioteca` v2, com todas as fotos — o que se manda a outra pessoa; cada ficha leva o `catalogo_id`) ou **Catálogo nacional** (`.jsonl.gz`, sem as fichas).
- **Migração v7** (`plantaterra_db.js#migrarBibliotecaUnificada`): as espécies do store `especie` viram fichas no táxon achado pelo id de catálogo ou pelo nome científico (sinônimo → aceito), ou registros próprios; as plantas dos projetos são religadas ao novo id; o store antigo é removido. O que foi digitado à mão conta como editado.
- **Filtros:** valem para a biblioteca inteira. Os que o catálogo traz (nível, reino, forma de vida, origem, estado, "só com nome popular") filtram os 166 mil táxons; os que só as fichas têm (altura, função, estrato, luz, floração, ciclo, foto, referências) restringem o resultado às fichas — o painel avisa — e, por isso, são resolvidos só pelo índice das fichas, sem varrer o catálogo.


### 15.1 Biblioteca de plantas (implementada)

Catálogo de espécies **global do aparelho** — não pertence a nenhum projeto, é reaproveitado por todos. Tela própria (`js/componentes/tela_biblioteca.js`, rota `#/biblioteca`, botão "🌱 Biblioteca de plantas" na lista de projetos): **Catálogo botânico agroflorestal** (`02_agroflorestal_curado.json`, campos acima como referência): o botão "⭱ Importar" da biblioteca e o "⭱ Importar" da lista de projetos reconhecem o arquivo (lista `plantas` com `identificacao`, `atributos`, `descricao`) e criam uma espécie por registro (`dominio/biblioteca_plantas.js#especieDeRegistroCatalogo`): o 1º nome popular é o principal (com inicial maiúscula) e todos ficam em `nomes_populares`; `observacoes_de_curadoria` vira `notas`; o aviso "(inferência para planejamento…)" sai do rótulo do estrato. Importar **mescla e nunca sobrescreve**: espécie já presente — mesmo nome popular + científico, ou **mesmo nome científico** (outro nome popular) — é pulada. A busca procura em **todos os nomes populares, no científico e nos sinônimos** e mostra "também: <nome>" quando achou por um nome que não é o principal. **Todos os campos do catálogo são importados**, inclusive os que só poucas espécies têm hoje (diâmetro, densidade, floração, sementes, germinação, advertência de conservação…) — campos novos que o catálogo ganhar vão para `extras` (e seções de texto novas para `detalhes`) e aparecem no detalhe como vieram. Tocar no card abre o detalhe completo (campos acima; textos longos recolhidos em seções; fontes como links). O formulário de edição cobre os campos básicos e "outros nomes populares"; os demais campos são preservados ao editar. **Ocorrência por estado:** `ocorrencia_estados` é extraída do texto (nomes de estado e de região com inicial maiúscula; ignora "para", "América do Sul" e "Sul de Minas") e é só o que o texto **afirma** — "do Ceará até Minas Gerais" cita os extremos, o meio não é inferido. No catálogo atual só 5 das 34 espécies citam estados (as demais dizem "cultivada em todo o Brasil" ou "originária da Ásia"); pintar esses estados no mapa é trabalho futuro.

**Identidade de uma espécie = nome popular + nome científico** (`chaveEspecie`): só repetir os dois é duplicata (cadastro e importação da biblioteca); o mesmo nome popular com científicos diferentes é permitido. A busca da biblioteca procura nos dois campos e destaca o trecho encontrado no card. Backup de projeto: cada planta leva `especie_nome_cientifico` e se religa pela dupla popular + científico (backups antigos, sem o científico, só se religam quando o nome identifica uma espécie só). Lista de **cards** (`<card-planta>`: nome popular, científico, ciclo · espaçamento e notas, sem botões — **tocar no card abre o detalhe da espécie**, com **Editar**, **Remover** e **Fechar**, já que não se edita toda hora) em grade que ganha colunas em telas largas, com busca (ignora caixa e acento, procura em nome popular e científico), criar, editar e excluir espécie.

```
ficha {                            // formato da ficha de uma espécie (campo `ficha` do registro, §15.0; até a v6 era o store `especie`)
  id,
  nome_popular: string,            // obrigatório; nome principal. Identidade = nome popular + científico (`chaveEspecie`)
  nome_cientifico: string | null,
  ciclo: "anual" | "bienal" | "perene" | null,
  espacamento_recomendado_m: number | null,
  notas: string | null,
  // --- campos do catálogo botânico (todos opcionais; espécies cadastradas à mão não os têm) ---
  nomes_populares: string[],       // todos os nomes (o principal vem primeiro); a busca e o vínculo por nome usam todos
  familia, autoria: string | null,
  sinonimos: string[],
  origem, forma_de_vida: string | null,
  altura_min_m, altura_max_m: number | null,
  estrato_saf, exigencia_luminosa: string | null,     // estrato é sugestão de planejamento, não classificação botânica
  funcoes, partes_utilizadas, usos: string[],
  ocorrencia_texto: string | null,
  ocorrencia_estados: string[],    // siglas de UF citadas no texto (`dominio/estados_brasil.js#extrairEstados`)
  altura_observacao: string | null,
  diametro_tronco_cm, emergencia_dias, germinacao_meses, mudas_prontas_meses: { min, max } | null,
  densidade_madeira_g_cm3, sementes_por_kg: number | null,
  floracao_meses, frutificacao_meses: number[],   // 1–12, na ordem dada (dezembro a março = [12, 1, 2, 3])
  viabilidade_sementes, taxa_germinacao: string | null,   // texto livre ("menos de 3", "superior a 60%")
  advertencia_conservacao, subfamilia, taxonomia_alternativa, referencia_botanica: string | null,
  ocorrencia_precisao: string | null,
  ocorrencia_geojson: object | null,   // GeoJSON de distribuição, quando o catálogo trouxer (hoje é sempre null)
  detalhes: { morfologia, madeira, utilidade, ecologia, fenologia, sementes, mudas, ...outras } | null,   // textos longos; seções desconhecidas ficam com o nome que vieram
  fonte_primaria: { tipo, pagina, arquivo_original, titulo_da_obra, nota } | null,
  rotulos_originais: { campo: rótulo como no livro } | null,
  extras: { "secao.chave": valor } | null,   // qualquer campo do catálogo que o app ainda não conhece: guardado como veio, para nada se perder
  fontes: string[],                // URLs
  catalogo_id: string | null,      // id do registro no arquivo do catálogo
  criado_em, atualizado_em
}
```

- **Sem espécies "pré-cadastradas" por padrão:** a biblioteca nasce vazia; ela se enche importando as fichas (§15.3) e o catálogo nacional (§15.2). Valores agronômicos vêm de fichas importadas ou da pessoa.
- **Vínculo com `planta_linha` é opcional.** No diálogo de planta de um metro, o campo "Espécie" **busca na biblioteca enquanto a pessoa digita** (`buscarCatalogo`, visão "espécies": nome popular ou científico, sinônimos resolvidos para o nome aceito; até 12 opções, **as com ficha completa primeiro** e marcadas "⭐ ficha completa", com o **trecho buscado em destaque**); tocar numa opção preenche o campo **e grava exatamente aquela espécie** (`especie_id` = id do registro). O mesmo nome popular pode ser de espécies diferentes (ex.: dois "ingá"): se o nome digitado bate com mais de uma, a lista continua aberta para desambiguar, e o vínculo só é automático quando o nome identifica uma espécie só. Texto que não está na biblioteca mostra o aviso de que fica só como texto (`especie_id: null`). O nome em texto (`planta_linha.especie`) é sempre gravado, então exportações e o mapa continuam funcionando mesmo sem a espécie. Os **cards das plantas do metro** mostram a capa e o nome científico da espécie ligada.
- **Editar ou excluir uma espécie não altera plantas já cadastradas** — elas guardam o nome em texto. (Renomear no catálogo, portanto, não renomeia as plantas existentes.)
- **Fichas como rotas (não diálogos):** a ficha de um registro da biblioteca (`#/biblioteca/taxon/<id>`) é uma **tela**, no mesmo padrão das demais: cabeçalho com **"←"** e migalhas `PlantaTerra / Biblioteca / <nome>`, o título com **✏️ e 🗑 à direita**, galeria de fotos, dados da ficha, taxonomia e relações. Lista e ficha são a mesma `<tela-biblioteca>`: o roteador (`main.js`) só chama `aoMudarRota()` quando o hash muda dentro de `#/biblioteca…`, sem recriar a tela, então **filtros, busca, páginas carregadas e rolagem da lista voltam como estavam**. O "←" e o botão voltar do aparelho usam o histórico (cada ficha aberta por um link de relação é uma entrada); aberta direto pela URL, o "←" leva à lista. O formulário de edição continua sendo um diálogo.
- **Fotos e referências:** a espécie pode ter `fotos` (`[{ src, legenda, credito }]`, só imagens embutidas em base64 — `data:image/jpeg|png|webp`, até 12 por espécie e ~300 KB cada; a 1ª vira a capa do card, também no card da planta do metro, e todas aparecem numa **galeria** no detalhe, com legenda e crédito do fotógrafo) e `referencias` (lista de textos; seção recolhida "Referências bibliográficas" no detalhe). Seções de texto novas da ficha (clima, solos, silvicultura, crescimento, espécies afins, etimologia, nomes por região…) entram em `detalhes` (até 20.000 caracteres cada). Origem dos dados: §15.3.
- **Filtros e ordenação** (`dominio/filtros_especies.js` + `<painel-filtros-especies>`): na biblioteca o botão **⚙ Filtros** abre um painel (bottom sheet) com chips e controles por **forma de vida** (árvore, arbusto, palmeira, erva, trepadeira… extraída do texto livre), **altura** (de/até, sobre a altura máxima da espécie; quem não tem altura fica fora ao usar a faixa; atalhos "até 3 m", "6 a 10 m"…), **função** (melífera, madeira, medicinal, restauração…; "qualquer" ou "todas"), **estrato no SAF**, origem, exigência de luz, **floresce/frutifica em** (meses), ciclo, estado de ocorrência, família, **com/sem foto**, com referências e com altura informada. Só aparece o que existe na biblioteca, cada opção com a contagem; dentro de um critério vale "qualquer um", entre critérios "todos". Os critérios ativos viram **chips que se removem com um toque**, o botão do painel mostra "Ver N plantas" ao vivo, a lista mostra "N de M plantas" e há **ordenação** (nome, científico, altura ↑↓, família; quem não tem o dado vai para o fim). Critérios e ordem ficam salvos no aparelho (`localStorage`). Os valores são normalizados (ex.: "apícola" → melífera; "pleno sol", "sol a meia-sombra" → sol / meia-sombra). **Limite dos dados:** o estrato do SAF só existe nas fichas curadas à mão (34); as fichas das obras da Embrapa (§15.3) não o trazem — filtrar por estrato exclui o resto. A aba "Catálogo nacional" ganhou os filtros "Forma de vida" e "Só com nome popular".
- **Importar/exportar** (`js/db/exportador_biblioteca.js`): arquivos `.json` de fichas — `{ formato: "plantaterra-biblioteca", formato_versao: 2, exportado_em, especies: [ficha + catalogo_id] }` (a versão 1, sem `catalogo_id`, ainda importa) ou um catálogo botânico (um registro rico por espécie) — e `.jsonl`/`.jsonl.gz` (catálogo nacional). O "Importar" é um só, em qualquer lugar: o app reconhece o arquivo. Regras de fusão e de exportação: §15.0.

### 15.2 Catálogo nacional (implementado)

Referência com **166.251 táxons** da **Flora e Funga do Brasil — JBRJ** (Darwin Core Archive, CC BY 4.0, versão 393.433 de 01/11/2026; é preciso citar o JBRJ — a citação aparece na aba do catálogo e na ficha), de **todos os reinos** (plantas, algas, fungos…) e **todos os níveis**: 130.807 espécies, 17.655 variedades, 2.097 subespécies, 738 formas, 14.190 gêneros, 502 famílias e níveis superiores; **aceitos e sinônimos** (90 mil). Fica **separado da biblioteca pessoal** (§15.1) num store próprio: é dado de referência, regenerável a partir do arquivo, não entra no backup de projeto e não tem curadoria agroflorestal (altura, uso, espaçamento etc. não vêm da fonte e ficam vazios — nada é inferido). O catálogo é **cumulativo**: o formato guarda campos desconhecidos como vieram, para fontes e campos futuros entrarem sem migração.

**Registro** (uma linha por táxon; chaves curtas, todas opcionais menos `id` e `c`; documentadas em `dominio/catalogo_nacional.js`): `id`, `c` nome científico sem autoria, `a` autoria, `k` nível (`sp var ssp f gen fam ord cla tri div sfam`), `st` status (`A` aceito, `S` sinônimo), `ns` status nomenclatural, `ai` **id do nome aceito**, `pi` **id do pai** (espécie → gênero → família → ordem…), `oi` **id do nome original (basiônimo)**, `pub`/`ano` publicação do nome, `md` modificado em, `f r fi cl or g` família, reino, filo, classe, ordem, gênero, `p` nomes populares, `pv` {nome: região do uso}, `n` nomes em outros idiomas, `o` origem, `uf`/`ufn`/`ufe` estados (todos/nativa/exótica), `d` domínios fitogeográficos, `e` endemismo, `v` forma de vida, `h` habitat, `vg` vegetação, `rel` **relações nomenclaturais**, `rf` **referências**, `tp` **espécimes-tipo**. Ao importar acrescentam-se `cn` (nome normalizado), `nv` (**nível de listagem**: `especie`, `infra`, `sinonimo`, `genero`, `superior`) e `busca` (palavras do nome científico e dos nomes populares).

**Relações entre registros** — quatro fontes, todas navegáveis na ficha: (1) **hierarquia** (`pi`: gênero, família… acima; "Contém" abaixo); (2) **sinônimo → nome aceito** (`ai`: a ficha do sinônimo avisa "Sinônimo de …", a do aceito lista os sinônimos); (3) **nome original** (`oi`: basiônimo e "nomes que partem deste"); (4) **relações nomenclaturais** (`rel`, vindas da extensão ResourceRelationship): "é sinônimo de / tem como sinônimo" do tipo **basiônimo** (o nome original de que a combinação deriva), **homotípico** (mesmo espécime-tipo) ou **heterotípico** (tipo diferente) — não coincidem com `ai` (em ~15 mil casos o alvo da relação não é o nome aceito). **Referências** (`rf`: citação, título, autor, data, tipo — "descrição original" —, link) e **espécimes-tipo** (`tp`: status, herbário, nº de catálogo, local, coletor, fonte) são listados na ficha (até 50 itens, com a contagem total).

- **Arquivo:** `ferramentas/gerar_super_catalogo.py <dwca> <saida>` gera `03_catalogo_nacional.jsonl.gz` (~12,6 MB; 100 MB descompactado): 1ª linha = cabeçalho `{formato: "plantaterra-catalogo-nacional", formato_versao: 2, fonte, citacao, versao_fonte, publicado_em, escopo}`, depois um registro por linha. Arquivos `formato_versao: 1` (só espécies aceitas) ainda importam. O arquivo **não vai para o git** (`temp/`).
- **Importação** (`db/catalogo_nacional.js#importarCatalogoNacional`, botão "Importar" da biblioteca, que reconhece `.jsonl`/`.jsonl.gz`): **streaming** (`File.stream()` + `DecompressionStream` + `TextDecoderStream`, linha a linha, sem carregar o arquivo na memória), **lotes de 1.500** por transação, com progresso. Reimportar atualiza pelo `id` (`jbrj-<taxonID>`; ids de `ai/pi/oi/rel` levam o mesmo prefixo), sem duplicar. ~26 s e ~115 MB de armazenamento para os 166 mil táxons. **Exportação** (`exportarCatalogoNacional`, botão "Exportar catálogo" na aba do catálogo): grava o store de volta no mesmo formato, para repassar a outras pessoas — reimportar reconstrói o catálogo idêntico. O cabeçalho (citação, versão) fica em `localStorage`.
- **Banco (IndexedDB v6):** store `catalogo` (`keyPath: id`), recriado (não migrado) na v6; índices `index_cientifico` (`cn`), `index_nivel_cientifico` (`[nv, cn]`) e `index_nivel_reino_cientifico` (`[nv, r, cn]`) para a listagem alfabética por nível e reino, `index_busca` (**multiEntry**), `index_pai`, `index_aceito`, `index_original` (navegação) e `index_familia`.
- **Listagem paginada** (`listarCatalogo`): ordem alfabética por **cursor com chave de retomada** (`{chave, id}` da página anterior — não reconta nem pula registros como `offset`), 40 por página, sem carregar o store; filtros de nível (padrão: espécies), reino, origem e estado. **Busca** (`buscarCatalogo`): cada palavra digitada tem de ser o **começo** de alguma palavra do nome científico/popular; o índice resolve a palavra mais longa e as demais filtram; relevância: científico exato → popular exato → científico começa → popular começa → resto; até 600 resultados (avisa "refine a busca"). Na visão **espécies**, um **sinônimo que bate vira o nome aceito** ("sinônimo: Tabebuia impetiginosa" no card). `contextoDoTaxon(id)` resolve de uma vez aceito, hierarquia, filhos, sinônimos, derivados e relações (listas longas cortadas em 60, com o total).
- **Tela** (`<tela-biblioteca>`): uma lista só — **"⭐ Com ficha completa"** primeiro (poucas centenas, filtradas e ordenadas em memória) e depois o **"Catálogo nacional"** (paginado por cursor, `IntersectionObserver` + "Mostrar mais"); busca única (com "Limpar"), **⚙ Filtros** (§15.1) e os mesmos `<card-planta>` (capa da ficha, quando há). Tocar num card abre a **ficha** (`<ficha-taxon>`, `componentes/ficha_taxon.js`: só desenha, emite `taxon-solicitado`, `editar-ficha` e `remover-ficha`); os registros relacionados são botões e cada toque abre a ficha do relacionado — a navegação é a do histórico (§15.1, "Fichas como rotas").
- **Diálogo de planta:** o autocomplete busca na biblioteca inteira (§15.1); escolher uma sugestão grava o `especie_id` do registro — não há mais "promover para a biblioteca", porque a espécie já está nela.
- Limites conhecidos: a busca é por começo de palavra (não acha no meio da palavra); estados vêm da lista da fonte, sem polígonos; a ficha mostra os 50 primeiros itens de referências/tipos.

### 15.3 Fontes Embrapa: fichas, fotos e referências (implementado, uso local)

**Arquivos de importação (em `temp/super/`, numerados pela ordem de carregamento):** `01a_embrapa_com_fotos.json` **ou** `01b_embrapa_sem_fotos.json` (um dos dois: as fichas ricas das obras da Embrapa, §15.3), depois `02_agroflorestal_curado.json` (34 espécies curadas à mão) e por fim `03_catalogo_nacional.jsonl.gz` (catálogo nacional, §15.2). É o mesmo botão "Importar", em qualquer aba: o app reconhece o arquivo (`.jsonl`/`.jsonl.gz` → catálogo nacional; `.json` → biblioteca pessoal). Como importar nunca sobrescreve, a ordem decide qual ficha prevalece quando a mesma espécie está em mais de um arquivo.

Duas obras da Embrapa viram fichas ricas da biblioteca pessoal (§15.1) — são o que o catálogo nacional (§15.2) não traz: altura, floração, sementes, mudas, clima, solos, madeira, usos, conservação. **Uso local:** texto e fotos têm direitos da Embrapa e dos autores, então os PDFs, os textos extraídos, as fotos e os arquivos gerados ficam em `temp/` (ignorado pelo git) e entram no app só pelo botão "Importar" da biblioteca; os **scripts** (sem conteúdo das obras) ficam em `ferramentas/`. `temp/LEIA-ME.md` indexa cada download (origem, data, tamanho, sha256).

- **Espécies Arbóreas Brasileiras** (P. E. R. Carvalho, 5 volumes, 2003–2014; ALICE/Embrapa): 340 fichas. `carvalho_texto.py` lê o PDF com `pdftotext -bbox-layout` e põe os blocos em **ordem de leitura por coluna** (as páginas têm 2 colunas; a leitura simples embaralha seções); `extrair_carvalho.py` separa as espécies (página com "Taxonomia e Nomenclatura" + "Família:"; título = nome popular e científico em blocos acima; volumes 3–5 às vezes põem o título numa página antes ou o omitem — cai no sumário), divide nas 14 seções fixas do livro e extrai por regra os campos que o texto afirma (altura, DAP, floração/frutificação em meses, sementes/kg, emergência, densidade, nomes vulgares sem as regiões, hierarquia). Hífens de quebra de linha são resolvidos pelo vocabulário do próprio livro.
- **Plantas para o Futuro — Região Sul** (MMA/Embrapa, 2011): 145 portfólios (Alimentícias, Medicinais, Madeireiras, Forrageiras, Ornamentais, Aromáticas, Fibrosas) por `extrair_plantas_futuro.py` (rótulos "Características botânicas", "Distribuição geográfica", "Hábitat", "Uso econômico…", "Propagação", "Situação de conservação", **"Referências bibliográficas"**…), 551 referências separadas uma a uma.
- **Fotos** (base64 no próprio arquivo, JPEG ≤ 360 px): Carvalho — cada ficha tem uma prancha (`carvalho_fotos.py` renderiza a página, apaga as legendas, separa as fotos por componentes conexos e liga cada legenda à foto mais próxima; fotos sobrepostas na prancha viram uma foto composta legendada com todas); Plantas para o Futuro — cada figura é uma imagem do PDF com posição conhecida (`extrair_fotos_plantas_futuro.py`, `mutool trace`), legenda "Figura N" e crédito "(Foto: …)". **Só entra o que é foto:** `classificar_foto.py` marca (`descartada`) e a geração ignora **faixas de cabeçalho** (tira escura com o nome científico por cima: proporção > 2,5), **desenhos técnicos** (≥ 50% branco e pouca cor: ciclos de vida, estruturas químicas) **fragmentos de página** (recorte com barra preta lisa na base) e **colagens** da prancha do volume 1 (várias legendas na mesma imagem, com legendas escritas dentro); páginas de abertura de capítulo também ficam de fora. Os recortes descartados continuam em `temp/` para auditoria. Resultado: 1.668 fotos (1.341 de Carvalho, 327 do Plantas para o Futuro) em 434 das 439 espécies.
- **Reconciliação com o JBRJ** (`gerar_biblioteca_embrapa.py`): o nome científico do livro (Cronquist/APG da época) é procurado no catálogo nacional; se for sinônimo vale o **nome aceito** e o do livro vira sinônimo; família, autoria, origem e estados vêm do JBRJ; `id` = `jbrj-<id>` (liga a ficha ao catálogo via `catalogo_id`). 7 nomes do livro (grafias antigas) não casam e ficam com o nome do livro. Espécie presente nas duas obras vira **uma ficha** (a de Carvalho recebe o que o portfólio do Sul traz; tópicos que divergem ficam duplicados com o sufixo "(Plantas para o Futuro)").
- **Saída:** `temp/super/01a_embrapa_com_fotos.json` (441 espécies, ~45 MB, com fotos) e `01b_embrapa_sem_fotos.json` (~9 MB; alternativa ao 01a, para celulares), no esquema do catálogo botânico (§15.1). A ficha guarda `fonte_primaria` (obra, volume/ano, página do PDF), `observacoes_de_curadoria` ("extração automática por regras — conferir no livro") e a taxonomia do livro em `extras`.

## 16. Fora de escopo / trabalho futuro

- Leitura automática da altura do laser via câmera (ideia explorada em `curvanivel_camera`, não descartada, mas não faz parte desta primeira versão).
- Sincronização em nuvem / múltiplos usuários no mesmo projeto.
- Exportação para formatos CAD (DXF/DWG) ou shapefile.
- Suavização avançada de curvas de nível (splines) além do que o Marching Squares produz.
- Cálculo de volume de terraplenagem/corte-aterro a partir do relevo.
- Importação de perímetro/curvas de nível a partir de um KML externo (só o fluxo próprio de GPS faz isso — ver §14.4).
- Roadmap de plantas (fotos, horta) — ver §15.

## 17. Estrutura de pastas (código atual)

```
src/html/                     # aplicação (código antigo do protótipo foi removido)
  index.html
  manifest.json
  sw.js
  css/
  js/
    main.js
    dados_apoio.js            # strings Pix "copia e cola" (§11.1)
    feedback_whatsapp.js      # link de feedback via WhatsApp (§11.2)
    consentimento_analytics.js # banner opt-in + carga do gtag.js (§12)
    componentes/              # web components (custom elements): mapa, captura GPS, painéis, editor de linha, apoiar, biblioteca de plantas
    dominio/                  # regras de negócio: nivelamento.js (§4), saf.js (§14.3), biblioteca_plantas.js (§15.1)
    geo/                      # geodesia.js, douglas_peucker.js, casco_convexo.js (§6.1), idw.js,
                               # marching_squares.js, curvas_de_nivel.js, segmentador_linha.js (§14.5), proximidade_metros.js e rumo.js (§14.9)
    gps/                      # captador de coordenada estabilizada (§5), captador de trilha (§6)
    kml/                      # leitura/escrita de KML/KMZ (§14.3, §14.4)
    db/                       # camada IndexedDB + exportadores (backup, GeoJSON/KML/KMZ)
  vendor/
    openlayers/               # ol.js + ol.css (mapa, com rotação)
    fflate/                   # zip/unzip para KMZ
    qrcode/                   # QR Code do painel de apoio (§11.1)
docs/
  especificacao.md            # este arquivo
```

## 18. Plano de implementação incremental

1. Estrutura base do app (HTML/CSS/JS shell, PWA manifest, sem funcionalidade ainda).
2. Camada de dados (IndexedDB) + CRUD de projetos.
3. Captura de coordenada estabilizada (§5) como componente isolado e testável.
4. Fluxo de estação de nível + leituras + cálculo de altitude relativa (§4), sem mapa ainda (lista/tabela).
5. Integração do mapa (OpenLayers, vendorizado; antes Leaflet) + exibição de pontos no mapa.
6. Captura de trilha de perímetro (§6) + desenho do polígono.
7. Pipeline de curvas de nível (§7): projeção, IDW, marching squares, desenho no mapa.
8. Exportação/Importação de projeto (backup JSON).
9. Service worker / instalação como PWA / cache de tiles.
10. Exportação GeoJSON/KML para GIS (§8, formatos além do backup).
11. Importação de KMZ/KML de SAF/linhas de plantio, segmentação em metros, cadastro de plantas por metro, e exportação unificada em KMZ (§14).
12. Polimento de UI mobile (contraste, botões, feedback de GPS).


### Navegação: seta para a landing e migalhas (breadcrumbs)

- A lista de projetos tem a seta **"←"** que volta para a landing page (`../../` a partir de `src/html/`).
- O cabeçalho do projeto mostra migalhas (que quebram em mais de uma linha, nunca truncam) no lugar do título: **"← Projeto / Agrofloresta / [SAF selecionado] / Linha X · metro N"** (nas vistas de perímetro e estações: "Projeto / Perímetro"). Cada trecho, exceto o último, é tocável e volta àquele nível ("Projeto" → tela de entrada; os demais fecham o painel de plantas). A seta "←" continua subindo um nível por vez. Por isso o painel de plantas não tem seta nem título próprios (economiza altura).
- A biblioteca de plantas e a tela de apoio usam o mesmo padrão: "← PlantaTerra / Biblioteca" e "← PlantaTerra / Apoiar" ("PlantaTerra" volta à lista de projetos).
- Ao abrir o projeto, o mapa enquadra a propriedade inteira usando `projeto.extensao_propriedade` (§8), sem esperar as camadas carregarem.
