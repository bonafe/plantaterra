/**
 * Regras puras da biblioteca de plantas (ver docs/especificacao.md secao
 * 15.1): normalização de nome para comparar espécies e saneamento de
 * registros vindos de arquivo importado.
 */

export const CICLOS_ESPECIE = ["anual", "bienal", "perene"];

/** Chave de comparação: sem acento, sem diferença de caixa, sem espaço sobrando. */
export function normalizarNome(texto) {
    return String(texto ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function textoOuNulo(valor, tamanhoMaximo) {
    if (typeof valor !== "string") return null;
    const limpo = valor.trim().slice(0, tamanhoMaximo);
    return limpo || null;
}

/**
 * Converte um objeto qualquer (ex: lido de um JSON importado) num registro
 * de espécie válido, ou null se não tiver nome popular utilizável.
 * Retorna só campos de domínio — id e datas são do banco.
 */
export function sanearEspecie(bruto) {
    if (!bruto || typeof bruto !== "object") return null;

    const nomePopular = textoOuNulo(bruto.nome_popular, 80);
    if (!nomePopular) return null;

    const espacamento = Number(bruto.espacamento_recomendado_m);

    return {
        nomePopular,
        nomeCientifico: textoOuNulo(bruto.nome_cientifico, 120),
        ciclo: CICLOS_ESPECIE.includes(bruto.ciclo) ? bruto.ciclo : null,
        espacamentoRecomendadoM: Number.isFinite(espacamento) && espacamento > 0 ? espacamento : null,
        notas: textoOuNulo(bruto.notas, 500)
    };
}
