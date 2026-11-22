// Mantenha sincronizado com VERSAO_APP em js/versao.js (rodapé do app) —
// bump os dois juntos a cada release, ver docs/especificacao.md secao 10.
const VERSAO_APP = "33";
const VERSAO_CACHE = `plantaterra-v${VERSAO_APP}`;
const CACHE_TILES = "plantaterra-tiles-v1";

const ARQUIVOS_DO_APP = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/estilo.css",
    "./js/main.js",
    "./js/versao.js",
    "./js/componentes/captura_gps.js",
    "./js/componentes/matriz_saf.js",
    "./js/componentes/andar_gps.js",
    "./js/componentes/dialogo_planta_metro.js",
    "./js/componentes/editor_pontos_trilha.js",
    "./js/componentes/campo_coordenada.js",
    "./js/componentes/campo_coordenada.html",
    "./js/componentes/dialogo_estacao.js",
    "./js/componentes/dialogo_estacao.html",
    "./js/componentes/dialogo_leitura.js",
    "./js/componentes/dialogo_leitura.html",
    "./js/componentes/lista_estacoes.js",
    "./js/componentes/lista_estacoes.html",
    "./js/componentes/dialogo_historico_perimetro.js",
    "./js/componentes/dialogo_importar_saf.js",
    "./js/componentes/lista_projetos.js",
    "./js/componentes/mapa_projeto.js",
    "./js/componentes/painel_projeto.js",
    "./js/componentes/tela_apoiar.js",
    "./js/componentes/tela_biblioteca.js",
    "./js/componentes/util_dom.js",
    "./js/apoio_pix.js",
    "./js/armazenamento.js",
    "./js/consentimento_analytics.js",
    "./js/dados_apoio.js",
    "./js/feedback_whatsapp.js",
    "./js/db/db_base.js",
    "./js/db/exportador_biblioteca.js",
    "./js/db/util_arquivo.js",
    "./js/db/exportador_projeto.js",
    "./js/db/exportador_geoespacial.js",
    "./js/db/plantaterra_db.js",
    "./js/dominio/biblioteca_plantas.js",
    "./js/dominio/nivelamento.js",
    "./js/dominio/saf.js",
    "./js/geo/curvas_de_nivel.js",
    "./js/geo/casco_convexo.js",
    "./js/geo/douglas_peucker.js",
    "./js/geo/geodesia.js",
    "./js/geo/idw.js",
    "./js/geo/marching_squares.js",
    "./js/geo/segmentador_linha.js",
    "./js/geo/matriz_saf.js",
    "./js/geo/proximidade_metros.js",
    "./js/geo/rumo.js",
    "./js/gps/captador_coordenada.js",
    "./js/gps/captador_rumo.js",
    "./js/gps/captador_trilha.js",
    "./js/kml/leitor_kml.js",
    "./js/kml/importador_saf.js",
    "./icons/icone-192.png",
    "./icons/icone-512.png",
    "./vendor/openlayers/ol.css",
    "./vendor/openlayers/ol.js",
    "./vendor/ultima/component_base.js",
    "./vendor/ultima/controller_base.js",
    "./vendor/ultima/reactive_component.js",
    "./vendor/fflate/fflate.js",
    "./vendor/qrcode/qrcode.min.js"
];

self.addEventListener("install", evento => {
    evento.waitUntil(
        caches.open(VERSAO_CACHE)
            .then(cache => cache.addAll(ARQUIVOS_DO_APP))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", evento => {
    evento.waitUntil(
        caches.keys().then(chaves =>
            Promise.all(
                chaves
                    .filter(chave => chave !== VERSAO_CACHE && chave !== CACHE_TILES)
                    .map(chave => caches.delete(chave))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", evento => {
    const url = new URL(evento.request.url);

    if (ehTileDeMapa(url)) {
        evento.respondWith(responderComCacheDeTiles(evento.request));
        return;
    }

    if (url.origin === self.location.origin) {
        evento.respondWith(responderComCacheDoApp(evento.request));
    }
});

function ehTileDeMapa(url) {
    return url.hostname.endsWith("tile.openstreetmap.org");
}

async function responderComCacheDoApp(requisicao) {
    const respostaCache = await caches.match(requisicao);
    if (respostaCache) return respostaCache;

    try {
        return await fetch(requisicao);
    } catch (erro) {
        if (requisicao.mode === "navigate") {
            return caches.match("./index.html");
        }
        throw erro;
    }
}

async function responderComCacheDeTiles(requisicao) {
    const cache = await caches.open(CACHE_TILES);
    const respostaCache = await cache.match(requisicao);

    const buscaNaRede = fetch(requisicao)
        .then(resposta => {
            cache.put(requisicao, resposta.clone());
            return resposta;
        })
        .catch(() => null);

    return respostaCache || (await buscaNaRede) || Response.error();
}
