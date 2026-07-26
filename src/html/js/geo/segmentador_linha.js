/**
 * Divide uma linha de plantio em segmentos de 1 metro (ver docs/especificacao.md secao 14.5).
 * Cada segmento é identificado por um índice 0-based e representa o metro
 * [indice, indice+1) ao longo da linha (o último pode ser mais curto que 1 m
 * se o comprimento total não for um múltiplo inteiro).
 */
import { criarProjetorLocal, centroide } from "./geodesia.js";

export function dividirEmMetros(pontosLinha, tamanhoSegmentoM = 1) {
    if (pontosLinha.length < 2) {
        return { comprimentoTotalM: 0, segmentos: [] };
    }

    const centro = centroide(pontosLinha);
    const projetor = criarProjetorLocal(centro.lat, centro.lon);
    const verticesXY = pontosLinha.map(p => projetor.paraMetros(p.lat, p.lon));

    const distanciasAcumuladas = [0];
    for (let i = 1; i < verticesXY.length; i++) {
        const anterior = verticesXY[i - 1];
        const atual = verticesXY[i];
        distanciasAcumuladas.push(distanciasAcumuladas[i - 1] + Math.hypot(atual.x - anterior.x, atual.y - anterior.y));
    }

    const comprimentoTotalM = distanciasAcumuladas[distanciasAcumuladas.length - 1];

    const interpolarEm = distancia => {
        if (distancia <= 0) return verticesXY[0];
        if (distancia >= comprimentoTotalM) return verticesXY[verticesXY.length - 1];

        let i = 1;
        while (distanciasAcumuladas[i] < distancia) i++;

        const distanciaInicioTrecho = distanciasAcumuladas[i - 1];
        const distanciaFimTrecho = distanciasAcumuladas[i];
        const t = (distancia - distanciaInicioTrecho) / (distanciaFimTrecho - distanciaInicioTrecho || 1);

        const inicio = verticesXY[i - 1];
        const fim = verticesXY[i];
        return { x: inicio.x + t * (fim.x - inicio.x), y: inicio.y + t * (fim.y - inicio.y) };
    };

    const numeroSegmentos = Math.ceil(comprimentoTotalM / tamanhoSegmentoM);
    const segmentos = [];

    for (let indice = 0; indice < numeroSegmentos; indice++) {
        const distanciaInicio = indice * tamanhoSegmentoM;
        const distanciaFim = Math.min((indice + 1) * tamanhoSegmentoM, comprimentoTotalM);
        const distanciaMeio = (distanciaInicio + distanciaFim) / 2;

        const inicioXY = interpolarEm(distanciaInicio);
        const fimXY = interpolarEm(distanciaFim);
        const meioXY = interpolarEm(distanciaMeio);

        segmentos.push({
            indice,
            comprimento: distanciaFim - distanciaInicio,
            inicio: projetor.paraCoordenada(inicioXY.x, inicioXY.y),
            fim: projetor.paraCoordenada(fimXY.x, fimXY.y),
            meio: projetor.paraCoordenada(meioXY.x, meioXY.y)
        });
    }

    return { comprimentoTotalM, segmentos };
}
