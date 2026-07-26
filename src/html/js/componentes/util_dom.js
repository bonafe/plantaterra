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

export function formatarMetros(valor, casasDecimais = 1) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
    return `${valor.toFixed(casasDecimais)} m`;
}

export function formatarArea(metrosQuadrados) {
    const hectares = metrosQuadrados / 10000;
    return `${hectares.toFixed(2)} ha (${Math.round(metrosQuadrados).toLocaleString("pt-BR")} m²)`;
}
