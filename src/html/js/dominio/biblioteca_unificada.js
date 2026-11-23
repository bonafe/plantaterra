/**
 * A biblioteca é uma só (docs/especificacao.md §15): cada registro do store `catalogo` é um táxon do catálogo nacional
 * e, quando a espécie tem dados ricos (Embrapa, curadoria, o que a pessoa preencheu), carrega também uma `ficha`.
 *
 *   registro = { …campos compactos do táxon (id, c, a, f, r, k, st, p, o, uf, v…, cn, nv, busca),
 *                ficha?        dados ricos no formato de espécie (nome_popular, altura_*, funcoes, fotos, referencias…)
 *                rica?: 1      marca quem tem ficha (índice `index_rica`)
 *                propria?: 1   espécie criada/importada sem correspondência no catálogo (id próprio)
 *                ficha_editada?: 1   a pessoa mexeu na ficha: uma importação nova só preenche o que falta
 *                ficha_origem?  de que arquivo veio a ficha: reimportar o MESMO arquivo a atualiza; outro arquivo só completa
 *                p_original?   nomes populares do catálogo (antes de somar os da ficha) — para desfazer a ficha }
 *
 * Funções puras: não conhecem banco nem tela.
 */
import { normalizarNome, sanearEspecie } from "./biblioteca_plantas.js";
import { especieDeTaxon, nivelDe, tokensDeBusca } from "./catalogo_nacional.js";

const vazio = v => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)
    || (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/** Saída de `sanearEspecie` (camelCase nos 5 primeiros campos) → formato de armazenamento da ficha. */
export function fichaDeSaneada(saneada) {
    const { nomePopular, nomeCientifico, ciclo, espacamentoRecomendadoM, notas, ...resto } = saneada;
    return { nome_popular: nomePopular, nome_cientifico: nomeCientifico, ciclo, espacamento_recomendado_m: espacamentoRecomendadoM, notas, ...resto };
}

/** Qualquer espécie "crua" (arquivo de biblioteca, catálogo botânico mapeado, formulário) → ficha saneada, ou null. */
export function fichaDeBruta(bruta) {
    const saneada = sanearEspecie(bruta);
    return saneada ? fichaDeSaneada(saneada) : null;
}

/** Junta duas fichas: `base` manda; só o que está vazio nela é preenchido por `extra`. */
export function preencherFicha(base, extra) {
    const saida = { ...base };
    for (const [chave, valor] of Object.entries(extra ?? {})) if (vazio(saida[chave]) && !vazio(valor)) saida[chave] = valor;
    return saida;
}

const unicos = lista => [...new Set(lista.filter(Boolean))];

/** Recalcula nomes populares e palavras de busca depois que a ficha mudou. */
function recalcularBusca(reg) {
    const doCatalogo = reg.p_original ?? reg.p ?? [];
    const daFicha = unicos([reg.ficha?.nome_popular, ...(reg.ficha?.nomes_populares ?? [])]).filter(n => normalizarNome(n) !== normalizarNome(reg.c));
    reg.p = unicos([...daFicha, ...doCatalogo]);
    if (!reg.p.length) delete reg.p;
    reg.busca = tokensDeBusca({ c: reg.c, p: reg.p, s: reg.ficha?.sinonimos });
    return reg;
}

/**
 * Registro com a ficha aplicada. `substituir`: troca a ficha inteira (importação sobre ficha não editada, ou a pessoa
 * salvando o formulário); senão só preenche o que falta.
 */
export function aplicarFicha(registro, ficha, { substituir = false, editada = false, origem = null } = {}) {
    const reg = { ...registro };
    if (reg.p_original === undefined) reg.p_original = reg.p ?? [];
    const trocou = substituir || !reg.ficha;
    reg.ficha = trocou ? { ...ficha } : preencherFicha(reg.ficha, ficha);
    reg.rica = 1;
    if (editada) reg.ficha_editada = 1;
    if (trocou && origem) reg.ficha_origem = origem;
    return recalcularBusca(reg);
}

/** Desfaz a ficha (volta a ser só o táxon do catálogo). */
export function semFicha(registro) {
    const { ficha, rica, ficha_editada, ficha_origem, p_original, ...reg } = registro;
    if (p_original?.length) reg.p = p_original; else delete reg.p;
    reg.busca = tokensDeBusca({ c: reg.c, p: reg.p });
    return reg;
}

const UF_DE = texto => texto;

/** Espécie criada sem correspondência no catálogo → registro próprio (id = o que vier, ou um novo). */
export function registroProprio(ficha, id) {
    const cientifico = ficha.nome_cientifico?.trim() || ficha.nome_popular;
    const base = {
        id,
        c: cientifico,
        cn: normalizarNome(cientifico),
        k: "sp",
        st: "A",
        r: ficha.reino ?? "—",
        propria: 1,
        ...(ficha.autoria ? { a: ficha.autoria } : {}),
        ...(ficha.familia ? { f: ficha.familia } : {}),
        ...(ficha.ocorrencia_estados?.length ? { uf: ficha.ocorrencia_estados.map(UF_DE) } : {}),
        ...(ficha.nome_cientifico ? {} : { sem_cientifico: 1 })
    };
    base.nv = nivelDe(base);
    return aplicarFicha(base, ficha, { substituir: true });
}

/** Registro mínimo para uma ficha que aponta para um táxon (jbrj-…) que ainda não está no catálogo importado. */
export function registroProvisorio(id, ficha) {
    const base = {
        id, c: ficha.nome_cientifico?.trim() || ficha.nome_popular, k: "sp", st: "A", r: "Plantae",
        ...(ficha.autoria ? { a: ficha.autoria } : {}), ...(ficha.familia ? { f: ficha.familia } : {})
    };
    base.cn = normalizarNome(base.c);
    base.nv = nivelDe(base);
    return aplicarFicha(base, ficha, { substituir: true });
}

/**
 * O registro como espécie (formato que a tela, os filtros e o diálogo de plantio entendem): os dados do táxon, com a
 * ficha por cima quando existe. `id` é o do registro — é com ele que a planta do projeto se liga à biblioteca.
 */
export function especieDoRegistro(registro) {
    const base = especieDeTaxon(registro);
    const saida = { ...base };
    for (const [chave, valor] of Object.entries(registro.ficha ?? {})) if (!vazio(valor)) saida[chave] = valor;
    // Táxon sem nome popular: o científico faz de nome principal; com ficha, o nome da ficha.
    saida.nome_popular = registro.ficha?.nome_popular ?? registro.p?.[0] ?? registro.c;
    saida.nome_cientifico = registro.sem_cientifico ? null : registro.c;
    saida.nomes_populares = unicos([saida.nome_popular, ...(registro.p ?? [])]);
    saida.id = registro.id;
    saida.catalogo_id = registro.id;
    saida.reino = registro.r;
    saida.tem_nome_popular = !!(registro.p?.length || (registro.ficha?.nome_popular && normalizarNome(registro.ficha.nome_popular) !== normalizarNome(registro.c)));
    saida.rica = !!registro.ficha;
    saida.propria = !!registro.propria;
    saida.fotos = registro.ficha?.fotos ?? [];
    saida.referencias = registro.ficha?.referencias ?? [];
    return saida;
}

/** Instantâneo leve para o backup: sem relações/referências do catálogo e, por padrão, só a foto de capa. */
export function instantaneoParaBackup(registro, { todasAsFotos = false } = {}) {
    const { cn, nv, busca, rel, rf, tp, p_original, ficha, ...compacto } = registro;
    const saida = { ...compacto };
    if (ficha) {
        const { fotos, ...resto } = ficha;
        saida.ficha = { ...resto, ...(fotos?.length ? { fotos: todasAsFotos ? fotos : [fotos[0]] } : {}) };
        saida.p_original = p_original;
    }
    return saida;
}

/** Instantâneo do backup → registro completo (campos de busca recalculados). */
export function registroDeInstantaneo(instantaneo) {
    const reg = { ...instantaneo };
    reg.cn = normalizarNome(reg.c);
    reg.nv = nivelDe(reg);
    reg.busca = tokensDeBusca({ c: reg.c, p: reg.p, s: reg.ficha?.sinonimos });
    if (reg.ficha) reg.rica = 1;
    return reg;
}
