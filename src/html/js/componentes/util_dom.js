export function escaparHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto ?? "";
    return div.innerHTML;
}

export function formatarData(timestamp) {
    return new Date(timestamp).toLocaleString("pt-BR");
}

export function formatarMetros(valor, casasDecimais = 1) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
    return `${valor.toFixed(casasDecimais)} m`;
}

export function formatarArea(metrosQuadrados) {
    const hectares = metrosQuadrados / 10000;
    return `${hectares.toFixed(2)} ha (${Math.round(metrosQuadrados).toLocaleString("pt-BR")} m²)`;
}
