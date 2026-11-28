/**
 * Regras de cálculo de altitude relativa para o nivelamento a laser.
 * Ver docs/especificacao.md secao 4 para a dedução das fórmulas.
 */

/**
 * Altitude relativa de um ponto lido por uma estação: a altitude do plano do laser menos o que a régua marcou.
 */
export function calcularAltitudeLeitura(estacao, alturaMira) {
    return estacao.altitude_laser - alturaMira;
}

/** Recalcula altitude_relativa de todas as leituras de uma estação. */
export function recalcularLeiturasDaEstacao(estacao, leituras) {
    return leituras.map(leitura => ({
        ...leitura,
        altitude_relativa: calcularAltitudeLeitura(estacao, leitura.altura_mira)
    }));
}

/** Nenhuma régua passa disso: um valor maior foi digitado em centímetros num campo que era em metros. */
export const ALTURA_MAXIMA_PLAUSIVEL_M = 10;

/** A interface fala em centímetros; o banco, o backup e as exportações GIS continuam em metros. */
export function metrosParaCm(metros) {
    return Math.round(metros * 1000) / 10;
}

export function cmParaMetros(cm) {
    return Math.round(cm * 10) / 1000;
}

/** "Estação N", pulando números já usados (para quando a pessoa não dá nome). */
export function nomePadraoDaEstacao(estacoes) {
    const usados = new Set(estacoes.map(e => e.nome));
    let numero = estacoes.length + 1;
    while (usados.has(`Estação ${numero}`)) numero++;
    return `Estação ${numero}`;
}

/**
 * Refaz, a partir só do que foi medido (leituras da régua, amarrações e zero escolhido), a altitude do laser de cada
 * estação e a altitude de cada leitura do projeto — usado depois de qualquer inclusão ou edição, porque uma medida
 * afeta as estações amarradas, em cadeia. Não altera os objetos recebidos. A altura do instrumento não entra: ela se
 * cancela na conta. Ver docs/especificacao.md secao 4.
 */
export function recalcularNivelamento(estacoesComLeituras) {
    const porId = new Map(estacoesComLeituras.map(item => [item.estacao.id, item]));
    const prontas = new Map();

    const resolver = (id, emAndamento) => {
        if (prontas.has(id)) return prontas.get(id);
        const item = porId.get(id);
        if (!item || emAndamento.has(id)) return null;
        emAndamento.add(id);

        const { estacao, leituras } = item;
        let altitudeDoLaser = 0;
        const referencia = estacao.amarrada_a_estacao_id
            ? resolver(estacao.amarrada_a_estacao_id, emAndamento)
            : null;
        const amarracaoAqui = leituras.find(l => l.eh_ponto_amarracao);
        const amarracaoLa = referencia?.leituras.find(l => l.eh_ponto_amarracao);
        if (amarracaoAqui && amarracaoLa) {
            // O mesmo ponto físico: altitude conhecida lá + o que a régua marcou aqui = altura deste laser.
            altitudeDoLaser = amarracaoLa.altitude_relativa + amarracaoAqui.altura_mira;
        }

        const estacaoNova = { ...estacao, altitude_laser: altitudeDoLaser };
        const resultado = { estacao: estacaoNova, leituras: recalcularLeiturasDaEstacao(estacaoNova, leituras) };
        prontas.set(id, resultado);
        return resultado;
    };

    const calculadas = estacoesComLeituras.map(({ estacao }) => resolver(estacao.id, new Set()));

    // Leva o zero de cada referência a 0, deslocando por igual todas as estações dela.
    const raizes = raizesDeReferencia(calculadas);
    const zeros = zerosPorRaiz(calculadas, raizes);
    return calculadas.map(item => {
        const zero = zeros.get(raizes.get(item.estacao.id));
        if (!Number.isFinite(zero?.altitude_relativa)) return item;
        const estacao = { ...item.estacao, altitude_laser: item.estacao.altitude_laser - zero.altitude_relativa };
        return { estacao, leituras: recalcularLeiturasDaEstacao(estacao, item.leituras) };
    });
}

/**
 * Para cada estação, a estação principal da sua referência de altitude: segue as amarrações enquanto houver o par de
 * leituras que as liga. Estações com a mesma raiz têm altitudes comparáveis.
 */
function raizesDeReferencia(estacoesComLeituras) {
    const porId = new Map(estacoesComLeituras.map(item => [item.estacao.id, item]));
    const temAmarracao = item => item?.leituras.some(l => l.eh_ponto_amarracao);

    return new Map(estacoesComLeituras.map(({ estacao }) => {
        const visitadas = new Set();
        let item = porId.get(estacao.id);
        while (!visitadas.has(item.estacao.id)) {
            visitadas.add(item.estacao.id);
            const referencia = porId.get(item.estacao.amarrada_a_estacao_id);
            if (!temAmarracao(item) || !temAmarracao(referencia)) break;
            item = referencia;
        }
        return [estacao.id, item.estacao.id];
    }));
}

/**
 * A leitura que vale zero em cada referência: a escolhida pela pessoa (a mais recente, se duas referências foram
 * unidas depois) ou, sem escolha, a primeira leitura da estação principal.
 */
function zerosPorRaiz(estacoesComLeituras, raizes) {
    const zeros = new Map();
    for (const { estacao, leituras } of estacoesComLeituras) {
        const raiz = raizes.get(estacao.id);
        for (const leitura of leituras) {
            if (leitura.zero_definido_em && !(zeros.get(raiz)?.zero_definido_em > leitura.zero_definido_em)) {
                zeros.set(raiz, leitura);
            }
        }
    }
    for (const { estacao, leituras } of estacoesComLeituras) {
        if (raizes.get(estacao.id) === estacao.id && !zeros.has(estacao.id) && leituras.length > 0) {
            zeros.set(estacao.id, leituras[0]);
        }
    }
    return zeros;
}

/** Ids das leituras que hoje valem zero. */
export function idsDasLeiturasZero(estacoesComLeituras) {
    const zeros = zerosPorRaiz(estacoesComLeituras, raizesDeReferencia(estacoesComLeituras));
    return new Set([...zeros.values()].map(l => l.id));
}

/**
 * Faz da leitura o zero da sua referência. Só marca a leitura (as medidas não mudam); as altitudes saem de
 * recalcularNivelamento.
 */
export function definirZero(estacoesComLeituras, leituraId, agora = Date.now()) {
    const raizes = raizesDeReferencia(estacoesComLeituras);
    const dona = estacoesComLeituras.find(item => item.leituras.some(l => l.id === leituraId));
    if (!dona) return estacoesComLeituras;

    return estacoesComLeituras.map(item => raizes.get(item.estacao.id) !== raizes.get(dona.estacao.id) ? item : {
        ...item,
        leituras: item.leituras.map(({ zero_definido_em, ...leitura }) =>
            leitura.id === leituraId ? { ...leitura, zero_definido_em: agora } : leitura)
    });
}

/** Quantas leituras de régua são grandes demais para estar mesmo em metros. */
export function contarAlturasSuspeitas(estacoesComLeituras) {
    return estacoesComLeituras.reduce((total, { leituras }) =>
        total + leituras.filter(l => l.altura_mira > ALTURA_MAXIMA_PLAUSIVEL_M).length, 0);
}

/** Divide por 100 só as leituras suspeitas (digitadas em cm) e recalcula tudo. Aplicar de novo não muda nada. */
export function corrigirAlturasDigitadasEmCm(estacoesComLeituras) {
    const corrigir = valor => valor > ALTURA_MAXIMA_PLAUSIVEL_M ? valor / 100 : valor;
    return recalcularNivelamento(estacoesComLeituras.map(({ estacao, leituras }) => ({
        estacao,
        leituras: leituras.map(l => ({ ...l, altura_mira: corrigir(l.altura_mira) }))
    })));
}

/**
 * Ids das altitudes muito afastadas das demais (provável erro de digitação): além de 3 intervalos interquartis dos
 * quartis, com um piso para terreno quase plano. Com menos de 8 leituras não há base para julgar.
 */
function idsDestoantes(leituras) {
    const validas = leituras.filter(l => Number.isFinite(l.altitude_relativa));
    if (validas.length < 8) return new Set();
    const ordenadas = validas.map(l => l.altitude_relativa).sort((a, b) => a - b);
    const quartil = fracao => ordenadas[Math.round((ordenadas.length - 1) * fracao)];
    const [q1, q3] = [quartil(0.25), quartil(0.75)];
    const folga = 3 * Math.max(q3 - q1, 0.25);
    return new Set(validas.filter(l => l.altitude_relativa < q1 - folga || l.altitude_relativa > q3 + folga).map(l => l.id));
}

/** As leituras (do projeto todo) que destoam das outras da mesma referência de altitude. */
export function leiturasDestoantes(estacoesComLeituras) {
    const faixas = faixasDeAltitudePorEstacao(estacoesComLeituras);
    return estacoesComLeituras.flatMap(({ estacao, leituras }) => leituras.filter(l => faixas.get(estacao.id).destoantes.has(l.id)));
}

/**
 * Faixa de altitudes { minimo, maximo, destoantes } usada para colorir as leituras de cada estação. Estações ligadas por
 * amarração têm a mesma referência e dividem a mesma faixa (mesma cor = mesma altura); as independentes têm a própria.
 * Leituras destoantes ficam fora da faixa, para uma só medida errada não achatar a escala das demais.
 */
export function faixasDeAltitudePorEstacao(estacoesComLeituras) {
    const raizes = raizesDeReferencia(estacoesComLeituras);

    const leiturasPorRaiz = new Map();
    for (const { estacao, leituras } of estacoesComLeituras) {
        const id = raizes.get(estacao.id);
        leiturasPorRaiz.set(id, [...(leiturasPorRaiz.get(id) ?? []), ...leituras]);
    }
    const faixaPorRaiz = new Map([...leiturasPorRaiz].map(([id, leituras]) => {
        const destoantes = idsDestoantes(leituras);
        const altitudes = leituras.filter(l => !destoantes.has(l.id)).map(l => l.altitude_relativa).filter(Number.isFinite);
        return [id, { minimo: Math.min(...altitudes), maximo: Math.max(...altitudes), destoantes }];
    }));
    return new Map(estacoesComLeituras.map(({ estacao }) => [estacao.id, faixaPorRaiz.get(raizes.get(estacao.id))]));
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
