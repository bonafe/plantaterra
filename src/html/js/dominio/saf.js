/**
 * Reconhecimento de pastas SAF e placemarks de Linha de Plantio, e parser
 * tolerante do nome da linha (ver docs/especificacao.md secao 14.3).
 */

import { normalizarNome } from "./biblioteca_plantas.js";

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
 * Totais para os resumos: { linhas, metros }. Trechos com o mesmo número ("Linha 3 Norte" e "Linha 3 Sul") contam
 * como uma linha só, como na matriz; os metros são os calculados da geometria (secao 14.2).
 */
export function resumirLinhas(linhas) {
    return {
        linhas: new Set(linhas.map(l => l.numero_linha ?? `id${l.id}`)).size,
        metros: linhas.reduce((soma, l) => soma + (l.comprimento_calculado_m ?? 0), 0)
    };
}

/** "15 linhas · 132,5 m lineares" */
export function descreverResumoLinhas({ linhas, metros }) {
    return `${linhas} ${linhas === 1 ? "linha" : "linhas"} · ` +
        `${metros.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m lineares`;
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

/**
 * Procura, entre as plantas já cadastradas num metro, uma da MESMA espécie que `nova` ({ especie, especieId }):
 * mesmo vínculo com a biblioteca (especie_id; ids diferentes = espécies diferentes, mesmo com o mesmo nome
 * popular) ou, na falta dele, mesmo nome sem caixa/acento.
 * Quem usa pergunta à pessoa se é uma planta nova (ex.: plantio de outro ano) ou a atualização da que já está.
 */
export function acharPlantaIgual(plantasDoMetro, nova) {
    const chave = normalizarNome(nova.especie);
    // Dois vínculos com a biblioteca decidem sozinhos (mesmo nome popular pode ser outra espécie);
    // se falta um dos lados, vale o nome.
    return plantasDoMetro.find(p => p.especie_id && nova.especieId
        ? p.especie_id === nova.especieId
        : normalizarNome(p.especie) === chave) ?? null;
}

/**
 * Planta existente já com os dados novos aplicados. `nova` = { especie, especieId, quantidade, sementes,
 * observacao, dataPlantio }. Com `parcial`, só o que a pessoa preencheu substitui (campo em branco mantém o
 * que já estava — é o "atualizar a existente" ao plantar de novo); sem `parcial` é a edição completa, em que
 * o formulário é a verdade inteira (dá para esvaziar um campo).
 */
export function aplicarDadosNaPlanta(existente, nova, { parcial = false } = {}) {
    const escolher = (novo, antigo) => (parcial && (novo === null || novo === undefined) ? antigo : novo ?? null);
    return {
        ...existente,
        // Atualizar a existente (parcial) não renomeia: o nome digitado só serviu para achá-la.
        especie: parcial ? existente.especie : nova.especie,
        especie_id: parcial ? (nova.especieId ?? existente.especie_id ?? null) : (nova.especieId ?? null),
        quantidade: escolher(nova.quantidade, existente.quantidade),
        sementes: escolher(nova.sementes, existente.sementes ?? null),
        observacao: escolher(nova.observacao, existente.observacao),
        data_plantio: escolher(nova.dataPlantio, existente.data_plantio)
    };
}
