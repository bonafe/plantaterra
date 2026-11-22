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

/**
 * Identidade de uma espécie na biblioteca: nome popular + nome científico. O mesmo nome popular pode ser de
 * espécies diferentes (ex.: dois "ingá"), então só é duplicada a que repete os DOIS.
 */
export function chaveEspecie(nomePopular, nomeCientifico) {
    return `${normalizarNome(nomePopular)}|${normalizarNome(nomeCientifico)}`;
}

/**
 * Parte `texto` em trechos [{ t, m }] marcando (m = true) onde aparece `consulta`, sem diferenciar caixa nem
 * acento — para destacar o que a pessoa procurou. Sem consulta (ou sem ocorrência) devolve um trecho só.
 */
export function segmentarDestaque(texto, consulta) {
    texto = String(texto ?? "");
    const alvo = normalizarNome(consulta);
    if (!alvo) return [{ t: texto, m: false }];

    // Texto normalizado caractere a caractere, guardando de qual posição original veio cada um.
    let normalizado = "";
    const origem = [];
    [...texto].forEach((caractere, i) => {
        const n = caractere.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        for (const c of n) { normalizado += c; origem.push(i); }
    });
    const caracteres = [...texto];

    const trechos = [];
    let cursor = 0;
    let achado = normalizado.indexOf(alvo);
    while (achado !== -1) {
        const inicio = origem[achado];
        const fim = origem[achado + alvo.length - 1] + 1;
        if (inicio >= cursor) {
            if (inicio > cursor) trechos.push({ t: caracteres.slice(cursor, inicio).join(""), m: false });
            trechos.push({ t: caracteres.slice(inicio, fim).join(""), m: true });
            cursor = fim;
        }
        achado = normalizado.indexOf(alvo, achado + alvo.length);
    }
    if (cursor < caracteres.length) trechos.push({ t: caracteres.slice(cursor).join(""), m: false });
    return trechos.length ? trechos : [{ t: texto, m: false }];
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
