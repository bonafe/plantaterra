/**
 * Reconhecimento de pastas SAF e placemarks de Linha de Plantio, e parser
 * tolerante do nome da linha (ver docs/especificacao.md secao 14.3).
 */

export function ehPastaSaf(nome) {
    return /^saf\b/i.test((nome ?? "").trim());
}

export function ehPlacemarkLinha(nome) {
    return /^linhas?\b/i.test((nome ?? "").trim());
}

const PADRAO_METROS_FINAIS = /-?\s*([\d]+(?:[.,]\d+)?)\s*m(?:etros)?(?:\s+lineares)?\.?\s*$/i;
const PADRAO_PREFIXO_LINHA = /^linhas?\b\s*[-:]?\s*/i;
const PADRAO_NUMERO_INICIAL = /^(\d+)\s*-?\s*/;

/**
 * Extrai { numero, descricao, metrosDeclarados } do nome de um placemark de
 * linha. Tolerante: nunca lança erro, na pior das hipóteses devolve tudo nulo
 * exceto a descrição (o nome original inteiro).
 */
export function parsearNomeLinha(nomeOriginal) {
    let resto = (nomeOriginal ?? "").trim().replace(PADRAO_PREFIXO_LINHA, "");

    let numero = null;
    const matchNumero = resto.match(PADRAO_NUMERO_INICIAL);
    if (matchNumero) {
        numero = parseInt(matchNumero[1], 10);
        resto = resto.slice(matchNumero[0].length);
    }

    let metrosDeclarados = null;
    const matchMetros = resto.match(PADRAO_METROS_FINAIS);
    if (matchMetros) {
        metrosDeclarados = parseFloat(matchMetros[1].replace(",", "."));
        resto = resto.slice(0, matchMetros.index);
    }

    const descricao = resto.replace(/^-\s*/, "").replace(/-\s*$/, "").trim();

    return { numero, descricao, metrosDeclarados };
}

/**
 * Agrupa uma lista de PlantaLinha por indice_metro.
 * Retorna um Map<indiceMetro, PlantaLinha[]>.
 */
export function agruparPlantasPorMetro(plantas) {
    const mapa = new Map();
    for (const planta of plantas) {
        const lista = mapa.get(planta.indice_metro) ?? [];
        lista.push(planta);
        mapa.set(planta.indice_metro, lista);
    }
    return mapa;
}
