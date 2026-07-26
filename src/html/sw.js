const VERSAO_CACHE = "plantaterra-v4";
const CACHE_TILES = "plantaterra-tiles-v1";

const ARQUIVOS_DO_APP = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/estilo.css",
    "./js/main.js",
    "./js/componentes/captura_gps.js",
    "./js/componentes/lista_projetos.js",
    "./js/componentes/mapa_projeto.js",
    "./js/componentes/painel_projeto.js",
    "./js/componentes/util_dom.js",
    "./js/db/db_base.js",
    "./js/db/exportador_projeto.js",
    "./js/db/exportador_geoespacial.js",
    "./js/db/plantaterra_db.js",
    "./js/dominio/nivelamento.js",
    "./js/dominio/saf.js",
    "./js/geo/curvas_de_nivel.js",
    "./js/geo/douglas_peucker.js",
    "./js/geo/geodesia.js",
    "./js/geo/idw.js",
    "./js/geo/marching_squares.js",
    "./js/geo/segmentador_linha.js",
    "./js/geo/matriz_saf.js",
    "./js/gps/captador_coordenada.js",
    "./js/gps/captador_trilha.js",
    "./js/kml/leitor_kml.js",
    "./js/kml/importador_saf.js",
    "./icons/icone-192.png",
    "./icons/icone-512.png",
    "./vendor/leaflet/leaflet.css",
    "./vendor/leaflet/leaflet.js",
    "./vendor/leaflet/images/layers.png",
    "./vendor/leaflet/images/layers-2x.png",
    "./vendor/leaflet/images/marker-icon.png",
    "./vendor/leaflet/images/marker-icon-2x.png",
    "./vendor/leaflet/images/marker-shadow.png",
    "./vendor/fflate/fflate.js"
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
