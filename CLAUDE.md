# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este projeto

PlantaTerra — PWA (mobile-first) para mapear o perímetro de uma propriedade rural e sua curva de nível usando só o celular: GPS para o perímetro e pontos de leitura, um nível a laser rotativo para altitude relativa. Também gerencia SAF (Sistemas Agroflorestais) e linhas de plantio. Site estático em português, sem build step, sem backend. Vanilla JS (ES modules), CSS puro. Roda 100% no navegador — todo dado do usuário fica só no IndexedDB do próprio aparelho; nada sai do dispositivo a menos que o usuário exporte manualmente. Ver `docs/especificacao.md` para a spec completa e viva do domínio (nivelamento ótico, algoritmos de geo, modelo de dados) — este arquivo é só o mapa de arquitetura/convenções para trabalhar no código, não repete a spec.

Repositório tem duas partes: `index.html` **na raiz** é a landing page institucional (objetivo, princípios, apoio, privacidade — sem PWA, sem service worker próprio); o app de verdade vive em `src/html/` (`https://bonafe.github.io/plantaterra/src/html/`). Publicado via GitHub Pages a partir da raiz do branch `main`. Ver `docs/especificacao.md` §11.3.

## Comandos

Sem build, sem bundler, sem `package.json`. Para testar localmente (a partir da raiz do repositório, pra servir tanto a landing page quanto o app):

```
python3 -m http.server 8080
```

Abre `http://localhost:8080/` pra landing page, `http://localhost:8080/src/html/` pra o app direto. Para testar num celular na mesma rede Wi-Fi, use o IP local da máquina (`hostname -I`) em vez de `localhost`. O service worker (`sw.js`) exige HTTPS ou `localhost` — não funciona por IP puro em alguns navegadores; para depurar cache/offline, teste via `localhost`.

Não há linter, testes automatizados ou framework de build. Verificação de sintaxe: `node --check <arquivo>` nos arquivos tocados. Sem suíte de testes — mudanças de UI são verificadas testando manualmente no navegador (emulação mobile + toque real via Puppeteer contra o Chrome instalado é o padrão usado nesta sessão quando não há acesso a um dispositivo real).

## Arquitetura

- **Local-first, sem backend.** IndexedDB (`js/db/plantaterra_db.js`, sobre `js/db/db_base.js`) é a única persistência. Exportação/importação em arquivo para backup e interoperabilidade GIS (GeoJSON/KML/KMZ).
- **PWA offline-first.** `sw.js` faz cache do app shell (lista explícita `ARQUIVOS_DO_APP`) e dos tiles de mapa já visitados. **Todo arquivo `.js`/`.css` novo precisa entrar em `ARQUIVOS_DO_APP`**, senão quebra ao abrir offline em campo.
- **Versão visível no rodapé** (`js/versao.js`, `VERSAO_APP`) — bump manual a cada release, **sempre junto** com `VERSAO_APP`/`VERSAO_CACHE` em `sw.js` (mesmo número nos dois arquivos). É o bump do cache do service worker que faz o app shell realmente trocar de versão num aparelho que já tinha a versão anterior instalada/cacheada; sem isso o rodapé mentiria.
- **Mapa**: Leaflet vendorizado (`vendor/leaflet/`, nunca CDN), encapsulado em `js/componentes/mapa_projeto.js` (`<mapa-projeto>`, um custom element por cima de uma instância única do Leaflet, com uma camada — `L.layerGroup` — por tipo de conteúdo: perímetro, pontos de trilha em edição, estações/leituras, isolinhas, linhas SAF, elementos de contexto).
- **Sem framework**: web components nativos (`customElements.define`) em `js/componentes/`, HTML montado via `innerHTML` de template strings, eventos via `addEventListener`/delegação. `<painel-projeto>` é a tela principal (mapa + todas as ações de um projeto); `<mapa-projeto>` e `<captura-gps>` são os outros custom elements.
- **Geo/algoritmos puros** em `js/geo/` (`geodesia.js` — projeção local equirretangular, distância haversine, área; `douglas_peucker.js` — simplificação de trilha; `casco_convexo.js` — fechamento por casco convexo para terrenos convexos; `idw.js`/`marching_squares.js`/`curvas_de_nivel.js` — pipeline de curvas de nível; `segmentador_linha.js`/`matriz_saf.js` — linhas de plantio). Cada algoritmo é uma função pura, sem estado, testável isoladamente.
- **Captura de GPS** em `js/gps/`: `captador_coordenada.js` (ponto único, estabilizado por N amostras + desvio padrão) e `captador_trilha.js` (captura contínua ao caminhar, com filtro de medóide em janela deslizante contra saltos de GPS — ver `docs/especificacao.md` §6).

### Modelo de dados — pontos que não são óbvios lendo o schema

- `trilha_perimetro.ativo` é o perímetro **principal** do projeto (resumo de área do topo, exportação completa) — só um por projeto. `trilha_perimetro.visivel` é independente e não-exclusivo: vários perímetros nomeados podem estar visíveis no mapa ao mesmo tempo (propriedade toda + áreas internas). Registros antigos sem `visivel` contam como visíveis (`visivel !== false`).
- `projeto.terreno_convexo` liga o fechamento por casco convexo (em vez de Douglas-Peucker) para **todas** as rodadas do projeto — alternar o campo recalcula e regrava todas na hora, não é um efeito só para capturas futuras.

### Organização de arquivos

- `src/html/js/componentes/` — web components (um por tela/peça de UI): `painel_projeto.js` (tela principal), `mapa_projeto.js`, `lista_projetos.js`, `captura_gps.js`, `util_dom.js` (formatadores/helpers compartilhados de DOM).
- `src/html/js/db/` — `plantaterra_db.js` (API de domínio sobre as object stores) + `db_base.js` (wrapper genérico Promise-based sobre IndexedDB, sem regra de negócio) + `exportador_projeto.js` (backup fiel) + `exportador_geoespacial.js` (GeoJSON/KML/KMZ, incluindo exportação avulsa de uma rodada).
- `src/html/js/geo/` — algoritmos puros de geometria/geodésia (ver acima).
- `src/html/js/gps/` — captadores de GPS (ver acima).
- `src/html/js/kml/` — leitura/importação de KML/KMZ (SAF, linhas de plantio, elementos de contexto).
- `src/html/js/dominio/` — regras de negócio que não são geometria pura: `nivelamento.js` (cálculo de altitude relativa), `saf.js` (parsing de nome de linha de plantio).
- `src/html/css/estilo.css` — único arquivo de CSS, sem pré-processador.
- `docs/especificacao.md` — a spec viva do domínio. **Ao mudar comportamento coberto por uma seção, atualize a seção junto no mesmo commit.**
- `vendor/` — bibliotecas de terceiros vendorizadas (Leaflet, fflate para zip/KMZ, qrcode para o painel de apoio) — nunca CDN, o app precisa abrir offline em campo.
- `index.html` (raiz) — landing page institucional, fora de `src/html/` (§11.3). Reaproveita módulos do app por caminho relativo (`js/apoio_pix.js`, `js/feedback_whatsapp.js`, `js/consentimento_analytics.js`) em vez de duplicar lógica — não entra no precache do service worker (escopo dele é só `src/html/`).

## Convenções

- Nomes de variáveis, funções, classes, comentários e textos de interface em **português** (pt-BR), em todo o código.
- Sem frameworks, sem bundler: manter o padrão de ES modules nativos + CSS simples. Bibliotecas de terceiros são sempre vendorizadas, nunca via CDN.
- **Bump de `VERSAO_APP` em `js/versao.js` E `sw.js` juntos, mesmo número, a cada commit que muda código** (ver seção Arquitetura acima).
- **Todo arquivo novo (`.js`/`.css`) precisa entrar em `ARQUIVOS_DO_APP` no `sw.js`**, senão quebra offline em campo.
- Mudanças de UI mobile: testar em viewport de celular com toque real (não só clique de mouse) antes de dar como funcionando — alvos de toque pequenos (menos de ~40px) são um erro recorrente neste projeto; ver histórico de commits sobre o editor de pontos da trilha.
- `<dialog>` com `showModal()` torna **todo o resto da página** inerte a cliques (não só escurece visualmente) — se uma tela precisa que o mapa (ou qualquer outra coisa fora do diálogo) continue clicável, não é um `<dialog>` modal: ou vira um modo de tela cheia dedicado (esconder as outras seções de verdade, não só visualmente — ver o editor de pontos em `painel_projeto.js`), ou um `<dialog>` não-modal via `.show()`.
- Ao adicionar/mudar um algoritmo geométrico, siga o padrão de `douglas_peucker.js`/`casco_convexo.js`: projetar para um plano local em metros via `geodesia.js#criarProjetorLocal`, operar em cartesiano, reprojetar de volta — nunca fazer trigonometria direto em lat/lon.
- Toda mudança de comportamento coberta por `docs/especificacao.md` precisa atualizar a seção correspondente no mesmo commit — é a spec viva do projeto, não um documento histórico.
