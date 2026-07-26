/**
 * Simplificação de trilha (algoritmo de Douglas-Peucker) para reduzir ruído do
 * GPS mantendo a forma geral do caminho. Opera sobre pontos {lat, lon} usando
 * distância perpendicular aproximada em um plano local (suficiente na escala
 * de uma propriedade).
 */
import { criarProjetorLocal, centroide, distanciaMetros } from "./geodesia.js";

export function simplificarTrilha(pontos, toleranciaMetros = 2) {
    if (pontos.length < 3) {
        return pontos.slice();
    }

    const c = centroide(pontos);
    const projetor = criarProjetorLocal(c.lat, c.lon);
    const cartesianos = pontos.map(p => ({ ...projetor.paraMetros(p.lat, p.lon), original: p }));

    const mantidos = douglasPeucker(cartesianos, toleranciaMetros);
    return mantidos.map(p => p.original);
}

function douglasPeucker(pontos, tolerancia) {
    if (pontos.length < 3) {
        return pontos;
    }

    const primeiro = pontos[0];
    const ultimo = pontos[pontos.length - 1];

    let distanciaMaxima = -1;
    let indiceMaximo = -1;

    for (let i = 1; i < pontos.length - 1; i++) {
        const distancia = distanciaPerpendicular(pontos[i], primeiro, ultimo);
        if (distancia > distanciaMaxima) {
            distanciaMaxima = distancia;
            indiceMaximo = i;
        }
    }

    if (distanciaMaxima > tolerancia) {
        const esquerda = douglasPeucker(pontos.slice(0, indiceMaximo + 1), tolerancia);
        const direita = douglasPeucker(pontos.slice(indiceMaximo), tolerancia);
        return esquerda.slice(0, -1).concat(direita);
    }

    return [primeiro, ultimo];
}

function distanciaPerpendicular(ponto, inicioSegmento, fimSegmento) {
    const dx = fimSegmento.x - inicioSegmento.x;
    const dy = fimSegmento.y - inicioSegmento.y;

    if (dx === 0 && dy === 0) {
        return Math.hypot(ponto.x - inicioSegmento.x, ponto.y - inicioSegmento.y);
    }

    const t = ((ponto.x - inicioSegmento.x) * dx + (ponto.y - inicioSegmento.y) * dy) / (dx * dx + dy * dy);
    const projecaoX = inicioSegmento.x + t * dx;
    const projecaoY = inicioSegmento.y + t * dy;

    return Math.hypot(ponto.x - projecaoX, ponto.y - projecaoY);
}

/**
 * Avalia o fechamento de uma trilha em polígono: a distância entre o primeiro
 * e o último ponto precisa ser pequena para indicar que o usuário completou a
 * volta pela divisa. O polígono em si (para desenho no Leaflet) é a própria
 * lista de pontos — polígonos se fecham automaticamente ao renderizar.
 */
export function avaliarFechamento(pontos, distanciaMaximaAceitavelMetros = 15) {
    if (pontos.length < 3) {
        return { fechamentoOk: false, distanciaFechamento: Infinity };
    }

    const primeiro = pontos[0];
    const ultimo = pontos[pontos.length - 1];
    const distanciaFechamento = distanciaMetros(primeiro.lat, primeiro.lon, ultimo.lat, ultimo.lon);

    return {
        fechamentoOk: distanciaFechamento <= distanciaMaximaAceitavelMetros,
        distanciaFechamento
    };
}
