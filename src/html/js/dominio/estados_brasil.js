/**
 * Estados e regiões do Brasil + extração dos estados citados num texto de ocorrência
 * (docs/especificacao.md §15.1): é o que permite pintar no mapa os estados onde uma espécie ocorre.
 * Função pura, sem estado.
 */

export const ESTADOS_BRASIL = [
    ["AC", "Acre"], ["AL", "Alagoas"], ["AP", "Amapá"], ["AM", "Amazonas"], ["BA", "Bahia"],
    ["CE", "Ceará"], ["DF", "Distrito Federal"], ["ES", "Espírito Santo"], ["GO", "Goiás"],
    ["MA", "Maranhão"], ["MT", "Mato Grosso"], ["MS", "Mato Grosso do Sul"], ["MG", "Minas Gerais"],
    ["PA", "Pará"], ["PB", "Paraíba"], ["PR", "Paraná"], ["PE", "Pernambuco"], ["PI", "Piauí"],
    ["RJ", "Rio de Janeiro"], ["RN", "Rio Grande do Norte"], ["RS", "Rio Grande do Sul"],
    ["RO", "Rondônia"], ["RR", "Roraima"], ["SC", "Santa Catarina"], ["SP", "São Paulo"],
    ["SE", "Sergipe"], ["TO", "Tocantins"]
].map(([uf, nome]) => ({ uf, nome }));

export const UFS_VALIDAS = new Set(ESTADOS_BRASIL.map(e => e.uf));

export const REGIOES_BRASIL = {
    "Norte": ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
    "Nordeste": ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "Centro-Oeste": ["DF", "GO", "MT", "MS"],
    "Sudeste": ["ES", "MG", "RJ", "SP"],
    "Sul": ["PR", "RS", "SC"]
};

function semAcento(texto) {
    return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const MAIUSCULA = /[A-ZÀ-Þ]/;

/**
 * Estados (siglas, em ordem alfabética) citados no texto: nomes de estado e nomes de região escritos com
 * inicial maiúscula ("Sul", "Nordeste"...), sem diferenciar acento. É o que o texto AFIRMA: "do Ceará até
 * Minas Gerais" cita só os dois extremos — o intervalo no meio não é inferido. Não contam: a preposição
 * "para" (só "Pará" com acento), "América do Sul", "Sul de Minas"/"norte do Paraná" (parte de um estado).
 */
export function extrairEstados(texto) {
    const achados = new Set();
    const original = String(texto ?? "").split("");
    const plano = semAcento(texto).split("");
    const apagar = (inicio, fim) => { for (let i = inicio; i < fim; i++) { original[i] = " "; plano[i] = " "; } };
    const ocorrencias = (regex, textoBase) => [...textoBase.join("").matchAll(regex)]
        .map(m => ({ inicio: m.index + m[1].length, fim: m.index + m[0].length }));

    // Expressões que contêm nome de região/estado sem se referir a eles.
    for (const { inicio, fim } of ocorrencias(/(^|[^a-z])(america do (?:sul|norte)|hemisferio (?:sul|norte))/g, plano)) apagar(inicio, fim);

    // O nome mais comprido primeiro: "Mato Grosso do Sul" contém "Mato Grosso" e "Sul"; "Rio Grande do
    // Norte/Sul" contém "Rio Grande".
    for (const { uf, nome } of [...ESTADOS_BRASIL].sort((a, b) => b.nome.length - a.nome.length)) {
        const alvo = semAcento(nome).replace(/ /g, "\\s+");
        for (const { inicio, fim } of ocorrencias(new RegExp(`(^|[^a-z])${alvo}(?![a-z])`, "g"), plano)) {
            const trecho = original.slice(inicio, fim).join("");
            const propriaMente = MAIUSCULA.test(original[inicio]) && (uf !== "PA" || trecho.includes("á"));
            if (!propriaMente) continue;
            achados.add(uf);
            apagar(inicio, fim);
        }
    }

    // Regiões, só com inicial maiúscula e fora de "Sul de Minas" (parte de um estado); "do país/Brasil" vale.
    const textoOriginal = original.join("");
    for (const [regiao, ufs] of Object.entries(REGIOES_BRASIL)) {
        const padrao = new RegExp(`(^|[^A-Za-zÀ-ÿ])${regiao}(?![A-Za-zÀ-ÿ])(?!\\s+(?:de|do|da|dos|das)\\s+(?!pa[ií]s|Brasil))`, "g");
        if (padrao.test(textoOriginal)) ufs.forEach(uf => achados.add(uf));
    }

    return [...achados].sort();
}
