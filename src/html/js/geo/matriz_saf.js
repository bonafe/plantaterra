/**
 * Calcula a matriz de um SAF: todas as suas linhas de plantio posicionadas
 * lado a lado, alinhadas por posição geográfica real (ver docs/especificacao.md
 * secao 14.5a). Resolve em particular o caso de uma linha dividida em duas
 * (ex: "Linha 3 Norte" e "Linha 3 Sul") por causa de um vão no meio — as duas
 * partes compartilham o mesmo `numero_linha` e são desenhadas na mesma fileira
 * da matriz, respeitando a distância real entre elas (o vão fica em branco).
 */
import { criarProjetorLocal, centroide } from "./geodesia.js";
import { dividirEmMetros } from "./segmentador_linha.js";

/**
 * @param {Array} linhas registros linha_plantio de um mesmo SAF
 * @param {number} tamanhoSegmentoM
 * @returns {{
 *   colunaMinimaGlobal: number, colunaMaximaGlobal: number,
 *   linhasLogicas: Array<{ numero: number|null, nomeExibicao: string, quadrados: Array<{
 *     colunaGlobal: number, linhaId: string, indiceMetro: number, coordenada: {lat,lon}
 *   }> }>
 * }}
 */
export function calcularMatrizSaf(linhas, tamanhoSegmentoM = 1) {
    const linhasComGeometria = linhas.filter(l => l.geometria?.length >= 2);
    if (linhasComGeometria.length === 0) {
        return { colunaMinimaGlobal: 0, colunaMaximaGlobal: -1, linhasLogicas: [] };
    }

    const todosPontos = linhasComGeometria.flatMap(l => l.geometria);
    const centro = centroide(todosPontos);
    const projetor = criarProjetorLocal(centro.lat, centro.lon);
    const [U, V] = calcularEixos(linhasComGeometria, projetor);

    const projecao = ponto => {
        const xy = projetor.paraMetros(ponto.lat, ponto.lon);
        return { u: xy.x * U.x + xy.y * U.y, v: xy.x * V.x + xy.y * V.y };
    };

    const segmentosPorLinha = linhasComGeometria.map(linha => ({
        linha,
        segmentos: dividirEmMetros(linha.geometria, tamanhoSegmentoM).segmentos.map(segmento => ({
            ...segmento,
            ...projecao(segmento.meio)
        }))
    }));

    const todosOsSegmentos = segmentosPorLinha.flatMap(({ segmentos }) => segmentos);
    const origemU = Math.min(...todosOsSegmentos.map(s => s.u));

    const colunaDoSegmento = segmento => Math.floor((segmento.u - origemU) / tamanhoSegmentoM);

    const grupos = new Map();
    for (const { linha, segmentos } of segmentosPorLinha) {
        const chave = linha.numero_linha !== null ? `n${linha.numero_linha}` : `id${linha.id}`;
        const grupo = grupos.get(chave) ?? { numero: linha.numero_linha, nomes: [], quadrados: [] };

        grupo.nomes.push(linha.nome_original);
        for (const segmento of segmentos) {
            grupo.quadrados.push({
                colunaGlobal: colunaDoSegmento(segmento),
                linhaId: linha.id,
                indiceMetro: segmento.indice,
                coordenada: segmento.meio
            });
        }
        grupos.set(chave, grupo);
    }

    const linhasLogicas = [...grupos.values()]
        .map(grupo => ({
            numero: grupo.numero,
            nomeExibicao: grupo.numero !== null ? `Linha ${grupo.numero}` : grupo.nomes[0],
            quadrados: grupo.quadrados.sort((a, b) => a.colunaGlobal - b.colunaGlobal)
        }))
        .sort((a, b) => {
            if (a.numero === null) return 1;
            if (b.numero === null) return -1;
            return a.numero - b.numero;
        });

    const todasAsColunas = todosOsSegmentos.map(colunaDoSegmento);

    return {
        colunaMinimaGlobal: Math.min(...todasAsColunas),
        colunaMaximaGlobal: Math.max(...todasAsColunas),
        linhasLogicas
    };
}

/**
 * Direção média das linhas do SAF (eixo "ao longo da fileira"), usando média
 * circular com ângulo dobrado para não cancelar linhas desenhadas em sentidos
 * opostos — e o eixo perpendicular ("através das fileiras").
 */
function calcularEixos(linhas, projetor) {
    let somaX = 0;
    let somaY = 0;

    for (const linha of linhas) {
        const inicio = projetor.paraMetros(linha.geometria[0].lat, linha.geometria[0].lon);
        const fim = projetor.paraMetros(
            linha.geometria[linha.geometria.length - 1].lat,
            linha.geometria[linha.geometria.length - 1].lon
        );
        const dx = fim.x - inicio.x;
        const dy = fim.y - inicio.y;
        const comprimento = Math.hypot(dx, dy);
        if (comprimento === 0) continue;

        const angulo = Math.atan2(dy, dx);
        somaX += comprimento * Math.cos(2 * angulo);
        somaY += comprimento * Math.sin(2 * angulo);
    }

    const anguloMedio = Math.atan2(somaY, somaX) / 2;
    return [
        { x: Math.cos(anguloMedio), y: Math.sin(anguloMedio) },
        { x: -Math.sin(anguloMedio), y: Math.cos(anguloMedio) }
    ];
}
