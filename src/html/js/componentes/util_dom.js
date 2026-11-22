export function escaparHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto ?? "";
    return div.innerHTML;
}

export function formatarData(timestamp) {
    return new Date(timestamp).toLocaleString("pt-BR");
}

/** Para datas puras (sem hora, ex: data de plantio) — evita deslocamento de fuso horário. */
export function formatarDataSimples(timestamp) {
    return new Date(timestamp).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/**
 * Faz o inverso de formatarDataSimples: interpreta um texto no formato
 * brasileiro dd/mm/aaaa (não confiamos no <input type="date"> nativo porque
 * seu formato de exibição segue o idioma do navegador/SO, não da página —
 * em navegadores configurados em inglês ele mostra mm/dd/aaaa mesmo com a
 * página inteira em pt-BR). Retorna um timestamp UTC ou null se inválido.
 */
export function parsearDataBr(texto) {
    const match = texto.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;

    const [, diaTexto, mesTexto, anoTexto] = match;
    const dia = Number(diaTexto);
    const mes = Number(mesTexto);
    const ano = Number(anoTexto);
    const timestamp = Date.UTC(ano, mes - 1, dia);

    const data = new Date(timestamp);
    const valido = data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
    return valido ? timestamp : null;
}

/**
 * "há 12 dias", "há 3 meses", "há 1 ano e 2 meses" a partir de uma data pura (timestamp UTC, como a
 * data de plantio). Hoje → "plantada hoje"; data futura → "plantio em dd/mm/aaaa".
 */
export function descreverIdadePlantio(timestamp, agora = new Date()) {
    const plantio = new Date(timestamp);
    const hojeUtc = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const dias = Math.round((hojeUtc - timestamp) / 86400000);
    if (dias < 0) return `plantio em ${formatarDataSimples(timestamp)}`;
    if (dias === 0) return "plantada hoje";
    if (dias < 30) return `plantada há ${dias} ${dias === 1 ? "dia" : "dias"}`;

    let meses = (agora.getFullYear() - plantio.getUTCFullYear()) * 12 + (agora.getMonth() - plantio.getUTCMonth());
    if (agora.getDate() < plantio.getUTCDate()) meses -= 1;
    const plural = (n, singular, pluralTexto) => `${n} ${n === 1 ? singular : pluralTexto}`;
    if (meses < 12) return `plantada há ${plural(meses, "mês", "meses")}`;
    const anos = Math.floor(meses / 12);
    const resto = meses % 12;
    return `plantada há ${plural(anos, "ano", "anos")}${resto ? ` e ${plural(resto, "mês", "meses")}` : ""}`;
}

export function formatarMetros(valor, casasDecimais = 1) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
    return `${valor.toFixed(casasDecimais)} m`;
}

export function formatarArea(metrosQuadrados) {
    const hectares = metrosQuadrados / 10000;
    return `${hectares.toFixed(2)} ha (${Math.round(metrosQuadrados).toLocaleString("pt-BR")} m²)`;
}
