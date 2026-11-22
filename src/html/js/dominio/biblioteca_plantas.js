/**
 * Regras puras da biblioteca de plantas (ver docs/especificacao.md secao
 * 15.1): normalização de nome para comparar espécies e saneamento de
 * registros vindos de arquivo importado.
 */

import { UFS_VALIDAS, extrairEstados } from "./estados_brasil.js";

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

/** Todos os nomes pelos quais uma espécie é conhecida (principal + outros), para busca e vínculo por nome. */
export function nomesDaEspecie(especie) {
    return [...new Set([especie.nome_popular, ...(especie.nomes_populares ?? [])].filter(Boolean))];
}

/** Textos em que a busca procura: nomes populares (todos), nome científico e sinônimos. */
export function textosDeBusca(especie) {
    return [...nomesDaEspecie(especie), especie.nome_cientifico, ...(especie.sinonimos ?? [])].filter(Boolean);
}

function textoOuNulo(valor, tamanhoMaximo) {
    if (typeof valor !== "string") return null;
    const limpo = valor.trim().slice(0, tamanhoMaximo);
    return limpo || null;
}

function listaDeTextos(valor, maximoItens, tamanhoMaximo) {
    if (!Array.isArray(valor)) return [];
    return [...new Set(valor.map(item => textoOuNulo(item, tamanhoMaximo)).filter(Boolean))].slice(0, maximoItens);
}

function numeroPositivoOuNulo(valor) {
    const numero = Number(valor);
    return valor !== null && valor !== "" && Number.isFinite(numero) && numero > 0 ? numero : null;
}

const SECOES_DESCRICAO = ["morfologia", "madeira", "utilidade", "ecologia", "fenologia", "sementes", "mudas"];

/** { min, max } (aceita só um dos lados ou um número solto), ou null. */
function faixaOuNulo(valor) {
    const faixa = typeof valor === "number" ? { min: valor, max: valor } : valor;
    if (!faixa || typeof faixa !== "object") return null;
    const min = numeroPositivoOuNulo(faixa.min);
    const max = numeroPositivoOuNulo(faixa.max);
    return min === null && max === null ? null : { min, max };
}

/** Meses do ano (1–12), na ordem dada (floração de dezembro a março é [12, 1, 2, 3]). */
function mesesOuVazio(valor) {
    if (!Array.isArray(valor)) return [];
    return [...new Set(valor.map(Number).filter(m => Number.isInteger(m) && m >= 1 && m <= 12))];
}

/** Texto ou número solto → texto (ex.: "menos de 3", 12). */
function textoDeValor(valor, tamanhoMaximo) {
    return textoOuNulo(typeof valor === "number" ? String(valor) : valor, tamanhoMaximo);
}

/** Objeto de textos { chave: texto } (descrições, rótulos originais, fonte primária): números viram texto; o resto é descartado. */
function mapaDeTextos(valor, maximoChaves, tamanhoMaximo) {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
    const entradas = Object.entries(valor).slice(0, maximoChaves)
        .map(([chave, texto]) => [chave.slice(0, 60), textoDeValor(texto, tamanhoMaximo)]);
    return entradas.some(([, texto]) => texto) ? Object.fromEntries(entradas) : null;
}

/** Qualquer dado que o catálogo trouxer e o PlantaTerra ainda não conhece: guardado como veio (limitado em tamanho). */
function extrasOuNulo(valor) {
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
    const entradas = Object.entries(valor).slice(0, 40)
        .filter(([, v]) => v !== null && v !== undefined && JSON.stringify(v).length <= 4000)
        .map(([chave, v]) => [chave.slice(0, 80), v]);
    return entradas.length ? Object.fromEntries(entradas) : null;
}

/** GeoJSON da ocorrência (polígonos de distribuição, quando o catálogo os tiver): só objetos GeoJSON de tamanho razoável. */
function geojsonOuNulo(valor) {
    if (!valor || typeof valor !== "object" || typeof valor.type !== "string") return null;
    return JSON.stringify(valor).length <= 300000 ? valor : null;
}

/**
 * Converte um objeto qualquer (ex: lido de um JSON importado) num registro
 * de espécie válido, ou null se não tiver nome popular utilizável.
 * Retorna só campos de domínio — id e datas são do banco. Os cinco primeiros campos vêm em camelCase (o que
 * `criarEspecie` recebe); os demais (catálogo botânico, §15.1) já vêm com o nome de armazenamento.
 */
export function sanearEspecie(bruto) {
    if (!bruto || typeof bruto !== "object") return null;

    const nomePopular = textoOuNulo(bruto.nome_popular, 80);
    if (!nomePopular) return null;

    const espacamento = Number(bruto.espacamento_recomendado_m);
    const ocorrenciaTexto = textoOuNulo(bruto.ocorrencia_texto, 1500);

    // Estados: os da lista, se houver; senão os citados no texto de ocorrência.
    const estados = listaDeTextos(bruto.ocorrencia_estados, 27, 2).filter(uf => UFS_VALIDAS.has(uf));
    // As seções conhecidas e qualquer outra que o catálogo traga (texto longo) ficam em `detalhes`.
    const detalhes = mapaDeTextos(bruto.detalhes, 30, 4000);

    return {
        nomePopular,
        nomeCientifico: textoOuNulo(bruto.nome_cientifico, 120),
        ciclo: CICLOS_ESPECIE.includes(bruto.ciclo) ? bruto.ciclo : null,
        espacamentoRecomendadoM: Number.isFinite(espacamento) && espacamento > 0 ? espacamento : null,
        notas: textoOuNulo(bruto.notas, 1000),

        nomes_populares: [...new Set([nomePopular, ...listaDeTextos(bruto.nomes_populares, 30, 80)])],
        familia: textoOuNulo(bruto.familia, 80),
        autoria: textoOuNulo(bruto.autoria, 120),
        sinonimos: listaDeTextos(bruto.sinonimos, 20, 160),
        origem: textoOuNulo(bruto.origem, 160),
        forma_de_vida: textoOuNulo(bruto.forma_de_vida, 80),
        altura_min_m: numeroPositivoOuNulo(bruto.altura_min_m),
        altura_max_m: numeroPositivoOuNulo(bruto.altura_max_m),
        estrato_saf: textoOuNulo(bruto.estrato_saf, 80),
        exigencia_luminosa: textoOuNulo(bruto.exigencia_luminosa, 120),
        funcoes: listaDeTextos(bruto.funcoes, 20, 60),
        partes_utilizadas: listaDeTextos(bruto.partes_utilizadas, 20, 60),
        usos: listaDeTextos(bruto.usos, 20, 60),
        ocorrencia_texto: ocorrenciaTexto,
        ocorrencia_estados: estados.length || !ocorrenciaTexto ? estados.sort() : extrairEstados(ocorrenciaTexto),
        detalhes,
        altura_observacao: textoOuNulo(bruto.altura_observacao, 300),
        diametro_tronco_cm: faixaOuNulo(bruto.diametro_tronco_cm),
        densidade_madeira_g_cm3: numeroPositivoOuNulo(bruto.densidade_madeira_g_cm3),
        floracao_meses: mesesOuVazio(bruto.floracao_meses),
        frutificacao_meses: mesesOuVazio(bruto.frutificacao_meses),
        sementes_por_kg: numeroPositivoOuNulo(bruto.sementes_por_kg),
        emergencia_dias: faixaOuNulo(bruto.emergencia_dias),
        germinacao_meses: faixaOuNulo(bruto.germinacao_meses),
        mudas_prontas_meses: faixaOuNulo(bruto.mudas_prontas_meses),
        viabilidade_sementes: textoDeValor(bruto.viabilidade_sementes, 120),
        taxa_germinacao: textoDeValor(bruto.taxa_germinacao, 120),
        advertencia_conservacao: textoOuNulo(bruto.advertencia_conservacao, 600),
        subfamilia: textoOuNulo(bruto.subfamilia, 120),
        taxonomia_alternativa: textoOuNulo(bruto.taxonomia_alternativa, 200),
        referencia_botanica: textoOuNulo(bruto.referencia_botanica, 300),
        ocorrencia_precisao: textoOuNulo(bruto.ocorrencia_precisao, 300),
        ocorrencia_geojson: geojsonOuNulo(bruto.ocorrencia_geojson),
        fonte_primaria: mapaDeTextos(bruto.fonte_primaria, 10, 300),
        rotulos_originais: mapaDeTextos(bruto.rotulos_originais, 20, 120),
        extras: extrasOuNulo(bruto.extras),
        fontes: listaDeTextos(bruto.fontes, 10, 300).filter(url => /^https?:\/\//i.test(url)),
        catalogo_id: textoOuNulo(bruto.catalogo_id, 80)
    };
}

// ---- Catálogo botânico agroflorestal (arquivo "catalogo_botanico_agroflorestal.json") ----

/** O arquivo é o catálogo botânico (lista `plantas` com `identificacao`), e não uma biblioteca do PlantaTerra? */
export function ehCatalogoBotanico(pacote) {
    return Array.isArray(pacote?.plantas) && typeof pacote.versao_esquema === "string"
        && pacote.plantas.some(planta => planta?.identificacao);
}

const capitalizar = texto => (typeof texto === "string" && texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

/** "alto/emergente (inferência para planejamento…)" → "alto/emergente": o aviso de curadoria sai do rótulo. */
const semParenteses = texto => (typeof texto === "string" ? texto.replace(/\s*\(.*$/, "").trim() : texto);

/**
 * Um registro do catálogo → o formato de biblioteca do PlantaTerra (campos de armazenamento), que depois
 * passa por `sanearEspecie`. O primeiro nome popular vira o principal; todos ficam em `nomes_populares`.
 */
export function especieDeRegistroCatalogo(registro) {
    const identificacao = registro?.identificacao ?? {};
    const atributos = registro?.atributos ?? {};
    const descricao = registro?.descricao ?? {};
    const nomes = (identificacao.nomes_populares ?? []).map(capitalizar);
    const fontes = (registro?.fontes_externas ?? []).map(fonte => (typeof fonte === "string" ? fonte : fonte?.url));

    // Tudo que o catálogo trouxer e ainda não tem campo próprio vai para `extras`, com o caminho de origem
    // ("atributos.chave"): nada se perde quando o catálogo ganhar campos novos.
    const extras = {};
    const separarConhecidos = (secao, objeto, conhecidos) => {
        for (const [chave, valor] of Object.entries(objeto ?? {})) {
            if (!conhecidos.includes(chave)) extras[`${secao}.${chave}`] = valor;
        }
    };
    separarConhecidos("identificacao", identificacao,
        ["nome_cientifico", "autoria", "nomes_populares", "familia", "sinonimos_conforme_livro", "tratamento_taxonomico_alternativo"]);
    separarConhecidos("atributos", atributos, [
        "origem_no_brasil", "forma_de_vida", "altura_m", "estrato_saf_sugerido", "exigencia_luminosa", "funcoes_agroflorestais",
        "partes_utilizadas", "usos", "ocorrencia_geografica", "diametro_tronco_cm", "densidade_madeira_g_cm3",
        "floracao_meses_brasil_livro", "frutificacao_meses_brasil_livro", "sementes_por_kg_aproximadamente", "emergencia_dias",
        "viabilidade_sementes_armazenamento_meses", "subfamilia_conforme_livro", "taxa_germinacao", "mudas_prontas_meses",
        "germinacao_meses", "advertencia_conservacao"]);
    // Seções de texto da descrição fora das conhecidas entram em `detalhes` com o nome que vieram.
    const secoesConhecidas = ["caracteristicas_morfologicas", "ocorrencia", "madeira", "utilidade", "informacoes_ecologicas",
        "fenologia", "obtencao_de_sementes", "producao_de_mudas"];
    const descricaoExtra = Object.fromEntries(Object.entries(descricao).filter(([chave, v]) => !secoesConhecidas.includes(chave) && typeof v === "string"));
    for (const chave of Object.keys(registro ?? {})) {
        if (!["id", "identificacao", "fonte_primaria", "descricao", "rotulos_originais", "atributos", "referencia_botanica_do_livro",
            "fontes_externas", "observacoes_de_curadoria"].includes(chave)) extras[chave] = registro[chave];
    }

    return {
        nome_popular: nomes[0] ?? null,
        nomes_populares: nomes,
        nome_cientifico: identificacao.nome_cientifico,
        autoria: identificacao.autoria,
        familia: identificacao.familia,
        sinonimos: identificacao.sinonimos_conforme_livro,
        taxonomia_alternativa: identificacao.tratamento_taxonomico_alternativo,
        subfamilia: atributos.subfamilia_conforme_livro,
        origem: atributos.origem_no_brasil,
        forma_de_vida: atributos.forma_de_vida,
        altura_min_m: atributos.altura_m?.min,
        altura_max_m: atributos.altura_m?.max,
        altura_observacao: atributos.altura_m?.observacao,
        estrato_saf: semParenteses(atributos.estrato_saf_sugerido),
        exigencia_luminosa: atributos.exigencia_luminosa,
        funcoes: atributos.funcoes_agroflorestais,
        partes_utilizadas: atributos.partes_utilizadas,
        usos: atributos.usos,
        diametro_tronco_cm: atributos.diametro_tronco_cm,
        densidade_madeira_g_cm3: atributos.densidade_madeira_g_cm3,
        floracao_meses: atributos.floracao_meses_brasil_livro,
        frutificacao_meses: atributos.frutificacao_meses_brasil_livro,
        sementes_por_kg: atributos.sementes_por_kg_aproximadamente,
        emergencia_dias: atributos.emergencia_dias,
        germinacao_meses: atributos.germinacao_meses,
        mudas_prontas_meses: atributos.mudas_prontas_meses,
        viabilidade_sementes: atributos.viabilidade_sementes_armazenamento_meses,
        taxa_germinacao: atributos.taxa_germinacao,
        advertencia_conservacao: atributos.advertencia_conservacao,
        ocorrencia_texto: descricao.ocorrencia ?? atributos.ocorrencia_geografica?.descricao,
        ocorrencia_precisao: atributos.ocorrencia_geografica?.precisao,
        ocorrencia_geojson: atributos.ocorrencia_geografica?.geometria_geojson,
        referencia_botanica: registro?.referencia_botanica_do_livro,
        detalhes: {
            morfologia: descricao.caracteristicas_morfologicas,
            madeira: descricao.madeira,
            utilidade: descricao.utilidade,
            ecologia: descricao.informacoes_ecologicas,
            fenologia: descricao.fenologia,
            sementes: descricao.obtencao_de_sementes,
            mudas: descricao.producao_de_mudas,
            ...descricaoExtra
        },
        fonte_primaria: registro?.fonte_primaria,
        rotulos_originais: registro?.rotulos_originais,
        fontes,
        notas: registro?.observacoes_de_curadoria,
        extras,
        catalogo_id: registro?.id
    };
}
