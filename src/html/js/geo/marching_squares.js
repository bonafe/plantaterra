/**
 * Extração de isolinhas (curvas de nível) de uma grade regular de valores via
 * Marching Squares. Retorna segmentos de reta (não junta em polilinhas
 * contínuas — desenhar todos os segmentos de um nível já forma visualmente a
 * curva de nível completa).
 *
 * Convenção dos cantos de cada célula (ver https://en.wikipedia.org/wiki/Marching_squares):
 *   a = superior-esquerdo, b = superior-direito, c = inferior-direito, d = inferior-esquerdo
 * Bits do caso: a*8 + b*4 + c*2 + d*1
 */

// Para cada caso (0-15): lista de pares de arestas a conectar por segmento.
// Arestas: T (topo, entre a-b), R (direita, entre b-c), B (base, entre d-c), L (esquerda, entre a-d)
const CASOS = {
    0: [],
    1: [["L", "B"]],
    2: [["B", "R"]],
    3: [["L", "R"]],
    4: [["T", "R"]],
    5: [["T", "L"], ["B", "R"]],
    6: [["T", "B"]],
    7: [["T", "L"]],
    8: [["T", "L"]],
    9: [["T", "B"]],
    10: [["T", "R"], ["L", "B"]],
    11: [["T", "R"]],
    12: [["L", "R"]],
    13: [["B", "R"]],
    14: [["L", "B"]],
    15: []
};

/**
 * @param {number[][]} grade matriz [linha][coluna] de valores (pode ter `null`)
 * @param {{xMin, yMin, passo}} origemGrade
 * @param {number} nivel valor da isolinha a extrair
 * @returns {Array<[{x,y}, {x,y}]>} lista de segmentos, em coordenadas cartesianas locais
 */
export function extrairIsolinha(grade, origemGrade, nivel) {
    const segmentos = [];
    const { xMin, yMin, passo } = origemGrade;

    for (let linha = 0; linha < grade.length - 1; linha++) {
        for (let coluna = 0; coluna < grade[linha].length - 1; coluna++) {
            const va = grade[linha][coluna];
            const vb = grade[linha][coluna + 1];
            const vc = grade[linha + 1][coluna + 1];
            const vd = grade[linha + 1][coluna];

            if (va === null || vb === null || vc === null || vd === null) {
                continue;
            }

            const indiceCaso = (va >= nivel ? 8 : 0) | (vb >= nivel ? 4 : 0) | (vc >= nivel ? 2 : 0) | (vd >= nivel ? 1 : 0);
            const pares = CASOS[indiceCaso];
            if (!pares.length) continue;

            const x0 = xMin + coluna * passo;
            const y0 = yMin + linha * passo;

            const pontosDasArestas = {
                T: pontoNaAresta(x0, y0, x0 + passo, y0, va, vb, nivel),
                R: pontoNaAresta(x0 + passo, y0, x0 + passo, y0 + passo, vb, vc, nivel),
                B: pontoNaAresta(x0, y0 + passo, x0 + passo, y0 + passo, vd, vc, nivel),
                L: pontoNaAresta(x0, y0, x0, y0 + passo, va, vd, nivel)
            };

            for (const [arestaA, arestaB] of pares) {
                segmentos.push([pontosDasArestas[arestaA], pontosDasArestas[arestaB]]);
            }
        }
    }

    return segmentos;
}

function pontoNaAresta(x1, y1, x2, y2, v1, v2, nivel) {
    const denominador = v2 - v1;
    const t = Math.abs(denominador) < 1e-9 ? 0.5 : (nivel - v1) / denominador;
    const tLimitado = Math.min(1, Math.max(0, t));
    return {
        x: x1 + tLimitado * (x2 - x1),
        y: y1 + tLimitado * (y2 - y1)
    };
}

/**
 * Extrai várias isolinhas igualmente espaçadas cobrindo o intervalo de valores
 * presentes na grade.
 */
export function extrairIsolinhas(grade, origemGrade, espacamento) {
    const valoresValidos = grade.flat().filter(v => v !== null);
    if (valoresValidos.length === 0) return [];

    const minimo = Math.min(...valoresValidos);
    const maximo = Math.max(...valoresValidos);

    const primeiroNivel = Math.ceil(minimo / espacamento) * espacamento;
    const isolinhas = [];

    for (let nivel = primeiroNivel; nivel <= maximo; nivel += espacamento) {
        const segmentos = extrairIsolinha(grade, origemGrade, nivel);
        if (segmentos.length > 0) {
            isolinhas.push({ nivel, segmentos });
        }
    }

    return isolinhas;
}
