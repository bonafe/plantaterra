/**
 * Regras de cálculo de altitude relativa para o nivelamento a laser.
 * Ver docs/especificacao.md secao 4 para a dedução das fórmulas.
 */

/**
 * Altitude do plano do laser para uma estação já com offset_altitude conhecido.
 */
export function altitudeDoPlanoDoLaser(estacao) {
    return estacao.offset_altitude + estacao.altura_instrumento;
}

/**
 * Altitude relativa de um ponto lido por uma estação.
 */
export function calcularAltitudeLeitura(estacao, alturaMira) {
    return altitudeDoPlanoDoLaser(estacao) - alturaMira;
}

/**
 * Recalcula altitude_relativa de todas as leituras de uma estação (chamar sempre
 * que altura_instrumento ou offset_altitude da estação mudar).
 */
export function recalcularLeiturasDaEstacao(estacao, leituras) {
    return leituras.map(leitura => ({
        ...leitura,
        altitude_relativa: calcularAltitudeLeitura(estacao, leitura.altura_mira)
    }));
}

/**
 * Calcula o offset_altitude de uma nova estação (estacaoNova) a partir de um par de
 * leituras de amarração: a leitura feita na estação já nivelada (leituraReferencia,
 * cuja altitude_relativa já é confiável) e a leitura do mesmo ponto físico feita pela
 * estacaoNova (leituraBruta, calculada com offset_altitude = 0).
 *
 * offset = altitude_confiavel_do_ponto - altitude_bruta_do_mesmo_ponto_na_nova_estacao
 */
export function calcularOffsetPorAmarracao(alturaMiraNaEstacaoNova, estacaoNova, altitudeConfiavelDoPontoAmarracao) {
    const estacaoComOffsetZero = { ...estacaoNova, offset_altitude: 0 };
    const altitudeBruta = calcularAltitudeLeitura(estacaoComOffsetZero, alturaMiraNaEstacaoNova);
    return altitudeConfiavelDoPontoAmarracao - altitudeBruta;
}

/**
 * Junta as leituras de todas as estações de um projeto (já com altitude_relativa
 * calculada) em uma única lista de pontos (lat, lon, altitude), pronta para o
 * pipeline de curvas de nível.
 */
export function consolidarPontosDoProjeto(estacoesComLeituras) {
    const pontos = [];
    for (const { leituras } of estacoesComLeituras) {
        for (const leitura of leituras) {
            if (leitura.altitude_relativa === null || leitura.altitude_relativa === undefined) {
                continue;
            }
            pontos.push({
                lat: leitura.coordenada.lat,
                lon: leitura.coordenada.lon,
                altitude: leitura.altitude_relativa
            });
        }
    }
    return pontos;
}
