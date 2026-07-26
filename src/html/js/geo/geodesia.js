/**
 * Funções geodésicas básicas compartilhadas (distância, projeção local).
 * Sem dependências externas.
 */

const RAIO_TERRA_METROS = 6371000;

export function paraRadianos(graus) {
    return graus * (Math.PI / 180);
}

/**
 * Distância aproximada em metros entre duas coordenadas (fórmula de Haversine).
 * Precisão suficiente na escala de uma propriedade rural.
 */
export function distanciaMetros(lat1, lon1, lat2, lon2) {
    const dLat = paraRadianos(lat2 - lat1);
    const dLon = paraRadianos(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(paraRadianos(lat1)) * Math.cos(paraRadianos(lat2)) * Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return RAIO_TERRA_METROS * c;
}

/**
 * Cria um projetor equirretangular local centrado em um ponto de referência
 * (ex: o centróide dos pontos do projeto). Suficiente para áreas do tamanho
 * de uma propriedade rural, evita a complexidade de UTM completo.
 *
 * Retorna { paraMetros(lat, lon) -> {x, y}, paraCoordenada(x, y) -> {lat, lon} }
 */
export function criarProjetorLocal(latReferencia, lonReferencia) {
    const latRefRad = paraRadianos(latReferencia);
    const metrosPorGrauLat = paraRadianos(1) * RAIO_TERRA_METROS;
    const metrosPorGrauLon = paraRadianos(1) * RAIO_TERRA_METROS * Math.cos(latRefRad);

    return {
        paraMetros(lat, lon) {
            return {
                x: (lon - lonReferencia) * metrosPorGrauLon,
                y: (lat - latReferencia) * metrosPorGrauLat
            };
        },
        paraCoordenada(x, y) {
            return {
                lat: latReferencia + y / metrosPorGrauLat,
                lon: lonReferencia + x / metrosPorGrauLon
            };
        }
    };
}

export function centroide(coordenadas) {
    const soma = coordenadas.reduce(
        (acc, c) => ({ lat: acc.lat + c.lat, lon: acc.lon + c.lon }),
        { lat: 0, lon: 0 }
    );
    return {
        lat: soma.lat / coordenadas.length,
        lon: soma.lon / coordenadas.length
    };
}

/**
 * Teste ponto-em-polígono (ray casting) em coordenadas cartesianas locais.
 */
export function pontoDentroDoPoligonoXY(ponto, poligonoXY) {
    let dentro = false;
    for (let i = 0, j = poligonoXY.length - 1; i < poligonoXY.length; j = i++) {
        const vi = poligonoXY[i];
        const vj = poligonoXY[j];
        const intersecta =
            (vi.y > ponto.y) !== (vj.y > ponto.y) &&
            ponto.x < ((vj.x - vi.x) * (ponto.y - vi.y)) / (vj.y - vi.y) + vi.x;
        if (intersecta) dentro = !dentro;
    }
    return dentro;
}

/**
 * Área de um polígono (lista de {lat, lon}, sem repetir o primeiro ponto no fim)
 * em metros quadrados, via fórmula do shoelace sobre a projeção local.
 */
export function areaPoligonoMetros2(pontos) {
    if (pontos.length < 3) return 0;

    const c = centroide(pontos);
    const projetor = criarProjetorLocal(c.lat, c.lon);
    const cartesianos = pontos.map(p => projetor.paraMetros(p.lat, p.lon));

    let soma = 0;
    for (let i = 0; i < cartesianos.length; i++) {
        const atual = cartesianos[i];
        const proximo = cartesianos[(i + 1) % cartesianos.length];
        soma += atual.x * proximo.y - proximo.x * atual.y;
    }
    return Math.abs(soma) / 2;
}
