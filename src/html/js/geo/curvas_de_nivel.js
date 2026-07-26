/**
 * Pipeline completo de geração de curvas de nível (ver docs/especificacao.md secao 7):
 * projeção local -> grade regular -> interpolação IDW -> extração de isolinhas
 * (Marching Squares) -> reprojeção para lat/lon, com recorte opcional pelo
 * polígono do perímetro.
 */
import { criarProjetorLocal, centroide, pontoDentroDoPoligonoXY } from "./geodesia.js";
import { gerarGrade, interpolarIDW } from "./idw.js";
import { extrairIsolinhas } from "./marching_squares.js";

/**
 * @param {Array<{lat, lon, altitude}>} pontos leituras já com altitude_relativa
 * @param {Array<{lat, lon}>} [poligonoPerimetro] opcional, para recortar a área
 * @param {object} opcoes { numeroCelulasLado, espacamento }
 * @returns {{ isolinhas: Array<{nivel, pontos: Array<Array<{lat,lon}>>}>, semDados: boolean }}
 */
export function gerarCurvasDeNivel(pontos, poligonoPerimetro = null, opcoes = {}) {
    if (pontos.length < 3) {
        return { isolinhas: [], semDados: true };
    }

    const centro = centroide(pontos);
    const projetor = criarProjetorLocal(centro.lat, centro.lon);

    const pontosXY = pontos.map(p => ({
        ...projetor.paraMetros(p.lat, p.lon),
        valor: p.altitude
    }));

    const poligonoXY = poligonoPerimetro
        ? poligonoPerimetro.map(p => projetor.paraMetros(p.lat, p.lon))
        : null;

    const grade = gerarGrade(pontosXY, opcoes.numeroCelulasLado ?? 50);
    const valoresGrade = interpolarIDW(pontosXY, grade);

    if (poligonoXY) {
        recortarGradePorPoligono(valoresGrade, grade, poligonoXY);
    }

    const espacamento = opcoes.espacamento ?? espacamentoAutomatico(pontosXY);
    const isolinhasXY = extrairIsolinhas(valoresGrade, grade, espacamento);

    const isolinhas = isolinhasXY.map(({ nivel, segmentos }) => ({
        nivel,
        pontos: segmentos.map(([p1, p2]) => [
            projetor.paraCoordenada(p1.x, p1.y),
            projetor.paraCoordenada(p2.x, p2.y)
        ])
    }));

    return { isolinhas, semDados: false };
}

function recortarGradePorPoligono(valoresGrade, grade, poligonoXY) {
    for (let linha = 0; linha < grade.linhas; linha++) {
        const y = grade.yMin + linha * grade.passo;
        for (let coluna = 0; coluna < grade.colunas; coluna++) {
            const x = grade.xMin + coluna * grade.passo;
            if (!pontoDentroDoPoligonoXY({ x, y }, poligonoXY)) {
                valoresGrade[linha][coluna] = null;
            }
        }
    }
}

function espacamentoAutomatico(pontosXY) {
    const valores = pontosXY.map(p => p.valor);
    const desnivel = Math.max(...valores) - Math.min(...valores);
    if (desnivel <= 0) return 1;
    const bruto = desnivel / 10;
    // arredonda para um número "redondo" (0.1, 0.2, 0.5, 1, 2, 5, 10...)
    const potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
    const candidatos = [1, 2, 5, 10].map(f => f * potencia);
    return candidatos.reduce((maisProximo, candidato) =>
        Math.abs(candidato - bruto) < Math.abs(maisProximo - bruto) ? candidato : maisProximo
    );
}
