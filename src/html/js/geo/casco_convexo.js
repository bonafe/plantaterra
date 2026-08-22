import { centroide, criarProjetorLocal } from "./geodesia.js";

/**
 * Casco convexo (algoritmo de Andrew, "monotone chain") de um conjunto de
 * pontos GPS — usado como método alternativo de fechamento do perímetro
 * para terrenos convexos (ver docs/especificacao.md secao 6): reconstrói a
 * divisa real mesmo quando o caminhado desviou para dentro do terreno em
 * trechos com obstáculos, porque os cantos verdadeiros continuam sendo
 * pontos extremos do conjunto e os desvios para dentro ficam descartados.
 * Só é geometricamente correto para terrenos sem reentrâncias.
 */
export function calcularCascoConvexo(pontos) {
    if (pontos.length < 3) return pontos.slice();

    const c = centroide(pontos);
    const projetor = criarProjetorLocal(c.lat, c.lon);
    const cartesianos = pontos
        .map(p => ({ ...projetor.paraMetros(p.lat, p.lon), original: p }))
        .sort((a, b) => a.x - b.x || a.y - b.y);

    const produtoVetorial = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const construirMetade = pontosOrdenados => {
        const metade = [];
        for (const p of pontosOrdenados) {
            while (metade.length >= 2 && produtoVetorial(metade[metade.length - 2], metade[metade.length - 1], p) <= 0) {
                metade.pop();
            }
            metade.push(p);
        }
        metade.pop();
        return metade;
    };

    const inferior = construirMetade(cartesianos);
    const superior = construirMetade(cartesianos.slice().reverse());

    return inferior.concat(superior).map(p => p.original);
}
