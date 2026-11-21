/**
 * Quais metros de plantio (quadrados da matriz do SAF) estão perto de uma
 * posição GPS — usado pelo modo "Andar na agrofloresta" (ver
 * docs/especificacao.md secao 14.9). Função pura: projeta tudo para um plano
 * local em metros centrado na posição (geodesia.js#criarProjetorLocal) e
 * mede distâncias em cartesiano.
 */
import { criarProjetorLocal } from "./geodesia.js";

export const RAIO_MINIMO_M = 3;
export const RAIO_MAXIMO_M = 12;

/**
 * O GPS de celular erra alguns metros, mais que o lado de um quadrado (1 m);
 * por isso o raio de busca acompanha a precisão informada pelo aparelho, com
 * piso e teto para não ficar nem pequeno demais nem uma lista enorme.
 */
export function raioDeBuscaM(precisaoM) {
    const precisao = Number.isFinite(precisaoM) ? precisaoM : RAIO_MINIMO_M;
    return Math.min(RAIO_MAXIMO_M, Math.max(RAIO_MINIMO_M, precisao));
}

/**
 * @param {{lat:number, lon:number}} posicao
 * @param {Array<{coordenada:{lat:number, lon:number}}>} quadrados qualquer objeto com `coordenada`
 * @param {number} raioM
 * @returns {{ proximos: Array<{quadrado, distanciaM}>, maisProximo: {quadrado, distanciaM} | null }}
 *   `proximos` ordenado do mais perto ao mais longe, só os dentro do raio;
 *   `maisProximo` é o mais perto de todos, mesmo fora do raio (para avisar
 *   "o metro mais próximo está a X m").
 */
export function encontrarMetrosProximos(posicao, quadrados, raioM, maximo = 60) {
    if (quadrados.length === 0) {
        return { proximos: [], maisProximo: null };
    }

    const projetor = criarProjetorLocal(posicao.lat, posicao.lon);
    const medidos = quadrados.map(quadrado => {
        const { x, y } = projetor.paraMetros(quadrado.coordenada.lat, quadrado.coordenada.lon);
        return { quadrado, distanciaM: Math.hypot(x, y) };
    });
    medidos.sort((a, b) => a.distanciaM - b.distanciaM);

    return {
        proximos: medidos.filter(m => m.distanciaM <= raioM).slice(0, maximo),
        maisProximo: medidos[0]
    };
}
