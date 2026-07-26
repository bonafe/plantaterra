/**
 * Interpolação IDW (Inverse Distance Weighting) sobre uma grade regular.
 * Ver docs/especificacao.md secao 7.
 */

/**
 * Gera uma grade regular cobrindo o bounding box dos pontos (em coordenadas
 * cartesianas locais, metros), com `numeroCelulasLado` células no maior lado.
 */
export function gerarGrade(pontosXY, numeroCelulasLado = 50) {
    const xs = pontosXY.map(p => p.x);
    const ys = pontosXY.map(p => p.y);

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    const largura = Math.max(xMax - xMin, 1e-6);
    const altura = Math.max(yMax - yMin, 1e-6);
    const maiorLado = Math.max(largura, altura);
    const passo = maiorLado / numeroCelulasLado;

    const colunas = Math.max(2, Math.ceil(largura / passo) + 1);
    const linhas = Math.max(2, Math.ceil(altura / passo) + 1);

    return { xMin, yMin, passo, colunas, linhas };
}

/**
 * Interpola o valor de `atributo` (ex: altitude) de `pontosXY` em cada célula
 * da grade, usando IDW com expoente `potencia`. Retorna uma matriz [linha][coluna]
 * de valores interpolados.
 */
export function interpolarIDW(pontosXY, grade, { potencia = 2, raioMinimoMetros = 0.5 } = {}) {
    const valores = [];

    for (let linha = 0; linha < grade.linhas; linha++) {
        const valoresLinha = [];
        const y = grade.yMin + linha * grade.passo;

        for (let coluna = 0; coluna < grade.colunas; coluna++) {
            const x = grade.xMin + coluna * grade.passo;
            valoresLinha.push(interpolarPonto(pontosXY, x, y, potencia, raioMinimoMetros));
        }

        valores.push(valoresLinha);
    }

    return valores;
}

function interpolarPonto(pontosXY, x, y, potencia, raioMinimoMetros) {
    let somaPesos = 0;
    let somaValoresPonderados = 0;

    for (const ponto of pontosXY) {
        const distancia = Math.max(Math.hypot(ponto.x - x, ponto.y - y), raioMinimoMetros);

        if (distancia < 1e-9) {
            return ponto.valor;
        }

        const peso = 1 / distancia ** potencia;
        somaPesos += peso;
        somaValoresPonderados += peso * ponto.valor;
    }

    return somaPesos === 0 ? null : somaValoresPonderados / somaPesos;
}
