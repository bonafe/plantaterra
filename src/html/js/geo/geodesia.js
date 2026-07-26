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
 * Comprimento total de uma polilinha (lista de {lat, lon}), somando a
 * distância entre vértices consecutivos.
 */
export function comprimentoPoligonal(pontos) {
    let soma = 0;
    for (let i = 1; i < pontos.length; i++) {
        soma += distanciaMetros(pontos[i - 1].lat, pontos[i - 1].lon, pontos[i].lat, pontos[i].lon);
    }
    return soma;
}

/**
 * Deriva a linha central de um polígono estreito (uma "faixa" com largura,
 * ex: uma linha de plantio desenhada com a largura real do canteiro).
 *
 * Não assume nenhuma ordem específica de desenho dos vértices (diferentes
 * pessoas/ferramentas desenham uma "faixa" de jeitos diferentes: percorrendo
 * um lado e voltando pelo outro, ou simplesmente contornando o perímetro
 * canto a canto) — em vez disso:
 *   1. Acha o eixo de maior variância dos vértices (PCA sobre um plano local),
 *      que é a direção "ao longo" da faixa, seja qual for a ordem de desenho.
 *   2. Projeta cada vértice nesse eixo e ordena por essa projeção.
 *   3. Agrupa vértices consecutivos (na ordem projetada) dois a dois — cada
 *      par representa os dois cantos de uma mesma "travessa" da faixa — e usa
 *      o ponto médio de cada par como um ponto da linha central, já em ordem
 *      ao longo da faixa. Um vértice sobrando (número ímpar) vira um ponto
 *      da linha central sozinho (ex: uma ponta arredondada/pontuda).
 *
 * @param {Array<{lat, lon}>} pontosPoligono anel do polígono (pode ou não repetir o primeiro ponto no fim)
 */
export function centralizarFaixaPoligonal(pontosPoligono) {
    let pontos = pontosPoligono;
    const primeiro = pontos[0];
    const ultimo = pontos[pontos.length - 1];
    if (pontos.length > 1 && primeiro.lat === ultimo.lat && primeiro.lon === ultimo.lon) {
        pontos = pontos.slice(0, -1);
    }
    if (pontos.length < 3) return pontos;

    const centro = centroide(pontos);
    const projetor = criarProjetorLocal(centro.lat, centro.lon);
    const pontosXY = pontos.map(p => projetor.paraMetros(p.lat, p.lon));

    let somaXX = 0;
    let somaYY = 0;
    let somaXY = 0;
    for (const p of pontosXY) {
        somaXX += p.x * p.x;
        somaYY += p.y * p.y;
        somaXY += p.x * p.y;
    }
    const anguloPrincipal = 0.5 * Math.atan2(2 * somaXY, somaXX - somaYY);
    const eixo = { x: Math.cos(anguloPrincipal), y: Math.sin(anguloPrincipal) };

    const ordenadosPelaProjecao = pontosXY
        .map(p => ({ xy: p, projecao: p.x * eixo.x + p.y * eixo.y }))
        .sort((a, b) => a.projecao - b.projecao);

    const centroXY = [];
    for (let i = 0; i < ordenadosPelaProjecao.length; i += 2) {
        const a = ordenadosPelaProjecao[i].xy;
        const b = ordenadosPelaProjecao[i + 1]?.xy;
        centroXY.push(b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a);
    }

    return centroXY.map(p => projetor.paraCoordenada(p.x, p.y));
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
