/**
 * Filtros e ordenação da biblioteca de plantas (docs/especificacao.md §15.1): transforma os campos livres de uma espécie
 * (forma de vida em texto, funções, estrato, origem, luz…) em valores normalizados, monta as opções disponíveis com
 * contagem (facetas) e aplica os critérios escolhidos. Funções puras, sem DOM nem banco.
 *
 * Critérios (todos opcionais; dentro de uma lista vale "qualquer um", entre critérios vale "todos"):
 *   formas[], funcoes[] (+ funcoesTodas: exigir todas), estratos[], origens[], luz[], ciclos[], familias[], ufs[],
 *   floracao[] / frutificacao[] (meses 1–12), alturaMin / alturaMax (m, sobre a altura máxima da espécie),
 *   comFoto (true | false), comReferencias (true), comAltura (true),
 *   reinos[], soComFicha (true), comNomePopular (true); `nivel` ("especie" é o padrão) é do banco, não da espécie
 */
import { normalizarNome } from "./biblioteca_plantas.js";

export const FILTROS_VAZIOS = Object.freeze({
    formas: [], funcoes: [], funcoesTodas: false, estratos: [], origens: [], luz: [], ciclos: [], familias: [], ufs: [],
    floracao: [], frutificacao: [], alturaMin: null, alturaMax: null, comFoto: null, comReferencias: null, comAltura: null,
    // Da biblioteca inteira (o catálogo tem 166 mil táxons; só alguns têm ficha completa):
    nivel: null, reinos: [], soComFicha: null, comNomePopular: null
});

export const NIVEIS_BIBLIOTECA = { especie: "Espécies", infra: "Variedades e subespécies", sinonimo: "Sinônimos", genero: "Gêneros", superior: "Famílias e acima" };
export const REINOS_BIBLIOTECA = ["Plantae", "Fungi"];

export const ROTULO_FUNCAO = {
    melifera: "Melífera", madeira: "Madeira", lenha_e_carvao: "Lenha e carvão", ornamental: "Ornamental", medicinal: "Medicinal",
    alimento: "Alimento", restauracao_ecologica: "Restauração ecológica", forragem: "Forragem", frutifera: "Frutífera",
    alimento_para_fauna: "Alimento para a fauna", biomassa: "Biomassa", sombra: "Sombra", atracao_de_polinizadores: "Atrai polinizadores",
    fibra: "Fibra", aromatica: "Aromática", adubacao_verde: "Adubação verde", fixacao_biologica_de_nitrogenio: "Fixa nitrogênio",
    biodiversidade: "Biodiversidade", cobertura_do_solo: "Cobertura do solo", cobertura_arborea: "Cobertura arbórea",
    pioneira: "Pioneira", sombra_temporaria: "Sombra temporária"
};
export const ROTULO_ESTRATO = { emergente: "Emergente", alto: "Alto", medio: "Médio", baixo: "Baixo" };
export const ROTULO_ORIGEM = { nativa: "Nativa", exotica: "Exótica", cultivada: "Cultivada" };
export const ROTULO_LUZ = { sol: "Pleno sol", "meia-sombra": "Meia-sombra", sombra: "Sombra" };
const ALIAS_FUNCAO = { apicola: "melifera", apicultura: "melifera", frutos: "frutifera", frutifero: "frutifera" };
export const NOMES_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const humanizar = chave => chave.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
export const rotuloDaFuncao = chave => ROTULO_FUNCAO[chave] ?? humanizar(chave);

/** "árvore pequena", "arbusto/arvoreta", "liana/volúvel/trepadeira" → conjunto de formas padronizadas. */
export function formasDe(texto) {
    const t = normalizarNome(texto).replace("herbacea arborescente", "erva");
    const formas = new Set();
    if (/arvore|arborea|arvoreta/.test(t)) formas.add("árvore");
    if (/subarbust/.test(t)) formas.add("subarbusto");
    if (/(^|[^a-z])arbust/.test(t)) formas.add("arbusto");
    if (/palmeira|palmacea/.test(t)) formas.add("palmeira");
    if (/erva|herbacea/.test(t)) formas.add("erva");
    if (/trepadeira|liana|volubel/.test(t)) formas.add("trepadeira");
    if (/epifit/.test(t)) formas.add("epífita");
    if (/suculent/.test(t)) formas.add("suculenta");
    if (/aquatic/.test(t)) formas.add("aquática");
    return formas;
}

export function estratosDe(texto) {
    const t = normalizarNome(texto);
    const achados = new Set();
    for (const chave of Object.keys(ROTULO_ESTRATO)) if (new RegExp(`\\b${chave}\\b`).test(t)) achados.add(chave);
    return achados;
}

export function origemDe(texto) {
    const t = normalizarNome(texto);
    if (/^nativ/.test(t)) return "nativa";
    if (/exotic/.test(t)) return "exotica";
    if (/cultivad/.test(t)) return "cultivada";
    return null;
}

export function luzDe(texto) {
    const t = normalizarNome(texto);
    const achados = new Set();
    if (/\bsol\b/.test(t)) achados.add("sol");
    if (/meia|parcial/.test(t)) achados.add("meia-sombra");
    if (/sombra/.test(t) && !/meia|parcial/.test(t)) achados.add("sombra");
    return achados;
}

const cache = new WeakMap();

/** Os valores normalizados de uma espécie (guardados por objeto, a lista inteira é refiltrada a cada toque). */
export function atributosDe(especie) {
    let a = cache.get(especie);
    if (a) return a;
    const alturaMax = especie.altura_max_m ?? especie.altura_min_m ?? null;
    a = {
        formas: formasDe(especie.forma_de_vida ?? ""),
        funcoes: new Set((especie.funcoes ?? []).map(f => ALIAS_FUNCAO[normalizarNome(f).replace(/\W+/g, "_")] ?? normalizarNome(f).replace(/\W+/g, "_"))),
        estratos: estratosDe(especie.estrato_saf ?? ""),
        origem: origemDe(especie.origem ?? ""),
        luz: luzDe(especie.exigencia_luminosa ?? ""),
        ciclo: especie.ciclo ?? null,
        familia: especie.familia ?? null,
        ufs: new Set(especie.ocorrencia_estados ?? []),
        floracao: new Set(especie.floracao_meses ?? []),
        frutificacao: new Set(especie.frutificacao_meses ?? []),
        alturaMax,
        temFoto: (especie.fotos?.length ?? 0) > 0,
        temReferencias: (especie.referencias?.length ?? 0) > 0,
        reino: especie.reino ?? null,
        rica: !!especie.rica,
        temNomePopular: especie.tem_nome_popular ?? (especie.nomes_populares?.length > 1)
    };
    cache.set(especie, a);
    return a;
}

const algum = (conjunto, escolhidos) => escolhidos.some(v => conjunto.has(v));

/** A espécie atende a todos os critérios ativos? */
export function atende(especie, f) {
    const a = atributosDe(especie);
    if (f.formas?.length && !algum(a.formas, f.formas)) return false;
    if (f.funcoes?.length && !(f.funcoesTodas ? f.funcoes.every(x => a.funcoes.has(x)) : algum(a.funcoes, f.funcoes))) return false;
    if (f.estratos?.length && !algum(a.estratos, f.estratos)) return false;
    if (f.origens?.length && !f.origens.includes(a.origem)) return false;
    if (f.luz?.length && !algum(a.luz, f.luz)) return false;
    if (f.ciclos?.length && !f.ciclos.includes(a.ciclo)) return false;
    if (f.familias?.length && !f.familias.includes(a.familia)) return false;
    if (f.ufs?.length && !algum(a.ufs, f.ufs)) return false;
    if (f.floracao?.length && !algum(a.floracao, f.floracao)) return false;
    if (f.frutificacao?.length && !algum(a.frutificacao, f.frutificacao)) return false;
    // Altura: quem não tem altura informada fica de fora assim que se pede uma faixa (não dá para afirmar que cabe).
    if ((f.alturaMin != null || f.alturaMax != null || f.comAltura) && a.alturaMax === null) return false;
    if (f.alturaMin != null && a.alturaMax < f.alturaMin) return false;
    if (f.alturaMax != null && a.alturaMax > f.alturaMax) return false;
    if (f.reinos?.length && !f.reinos.includes(a.reino)) return false;
    if (f.soComFicha && !a.rica) return false;
    if (f.comNomePopular && !a.temNomePopular) return false;
    if (f.comFoto === true && !a.temFoto) return false;
    if (f.comFoto === false && a.temFoto) return false;
    if (f.comReferencias && !a.temReferencias) return false;
    return true;
}

export const filtrar = (especies, filtros) => especies.filter(e => atende(e, filtros));

export function contarCriterios(f) {
    return ["formas", "funcoes", "estratos", "origens", "luz", "ciclos", "familias", "ufs", "floracao", "frutificacao", "reinos"].filter(k => f[k]?.length).length
        + (f.alturaMin != null || f.alturaMax != null ? 1 : 0) + (f.comFoto !== null && f.comFoto !== undefined ? 1 : 0)
        + (f.comReferencias ? 1 : 0) + (f.comAltura ? 1 : 0) + (f.soComFicha ? 1 : 0) + (f.comNomePopular ? 1 : 0)
        + (f.nivel && f.nivel !== "especie" ? 1 : 0);
}

/**
 * Algum critério só pode ser satisfeito por espécie com ficha (o catálogo não traz altura, função, luz, estrato,
 * meses, foto…)? Então a busca nem precisa olhar os 166 mil táxons: basta o índice das fichas.
 */
export function exigeFicha(f) {
    return !!(f.soComFicha || f.funcoes?.length || f.estratos?.length || f.luz?.length || f.ciclos?.length || f.floracao?.length
        || f.frutificacao?.length || f.alturaMin != null || f.alturaMax != null || f.comFoto === true || f.comReferencias || f.comAltura);
}

/** Opções que existem na lista, com quantas espécies têm cada uma — só aparece o que dá resultado. */
export function construirFacetas(especies) {
    const facetas = { formas: new Map(), funcoes: new Map(), estratos: new Map(), origens: new Map(), luz: new Map(), ciclos: new Map(), familias: new Map(),
        ufs: new Map(), floracao: new Map(), frutificacao: new Map(), comFoto: 0, comReferencias: 0, comAltura: 0, total: especies.length };
    const soma = (mapa, chave) => mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    for (const e of especies) {
        const a = atributosDe(e);
        a.formas.forEach(v => soma(facetas.formas, v));
        a.funcoes.forEach(v => soma(facetas.funcoes, v));
        a.estratos.forEach(v => soma(facetas.estratos, v));
        a.luz.forEach(v => soma(facetas.luz, v));
        a.ufs.forEach(v => soma(facetas.ufs, v));
        a.floracao.forEach(v => soma(facetas.floracao, v));
        a.frutificacao.forEach(v => soma(facetas.frutificacao, v));
        if (a.origem) soma(facetas.origens, a.origem);
        if (a.ciclo) soma(facetas.ciclos, a.ciclo);
        if (a.familia) soma(facetas.familias, a.familia);
        if (a.temFoto) facetas.comFoto++;
        if (a.temReferencias) facetas.comReferencias++;
        if (a.alturaMax !== null) facetas.comAltura++;
    }
    return facetas;
}

/** Chips legíveis dos critérios ativos: [{ id, grupo, valor, texto }] — `id`+`valor` dizem o que remover ao tocar no chip. */
export function descreverFiltros(f) {
    const chips = [];
    const lista = (grupo, valores, rotulo) => (valores ?? []).forEach(v => chips.push({ grupo, valor: v, texto: rotulo(v) }));
    lista("formas", f.formas, v => v.replace(/^./, c => c.toUpperCase()));
    lista("funcoes", f.funcoes, rotuloDaFuncao);
    lista("estratos", f.estratos, v => `Estrato ${ROTULO_ESTRATO[v] ?? v}`.toLowerCase().replace(/^./, c => c.toUpperCase()));
    lista("origens", f.origens, v => ROTULO_ORIGEM[v] ?? v);
    lista("luz", f.luz, v => ROTULO_LUZ[v] ?? v);
    lista("ciclos", f.ciclos, v => humanizar(v));
    lista("familias", f.familias, v => v);
    lista("ufs", f.ufs, v => v);
    lista("floracao", f.floracao, v => `Flora em ${NOMES_MESES[v - 1]}`);
    lista("frutificacao", f.frutificacao, v => `Frutifica em ${NOMES_MESES[v - 1]}`);
    if (f.alturaMin != null || f.alturaMax != null) {
        const texto = f.alturaMin != null && f.alturaMax != null ? `Altura ${f.alturaMin}–${f.alturaMax} m` : f.alturaMax != null ? `Altura até ${f.alturaMax} m` : `Altura a partir de ${f.alturaMin} m`;
        chips.push({ grupo: "altura", valor: null, texto });
    }
    lista("reinos", f.reinos, v => v);
    if (f.nivel && f.nivel !== "especie") chips.push({ grupo: "nivel", valor: null, texto: NIVEIS_BIBLIOTECA[f.nivel] ?? f.nivel });
    if (f.soComFicha) chips.push({ grupo: "soComFicha", valor: null, texto: "Só com ficha completa" });
    if (f.comNomePopular) chips.push({ grupo: "comNomePopular", valor: null, texto: "Só com nome popular" });
    if (f.comFoto === true) chips.push({ grupo: "comFoto", valor: null, texto: "Com foto" });
    if (f.comFoto === false) chips.push({ grupo: "comFoto", valor: null, texto: "Sem foto" });
    if (f.comReferencias) chips.push({ grupo: "comReferencias", valor: null, texto: "Com referências" });
    if (f.comAltura) chips.push({ grupo: "comAltura", valor: null, texto: "Com altura informada" });
    return chips;
}

/** Remove do critério o valor de um chip. */
export function semChip(filtros, chip) {
    const novo = { ...filtros };
    if (chip.grupo === "altura") { novo.alturaMin = null; novo.alturaMax = null; }
    else if (["comFoto"].includes(chip.grupo)) novo.comFoto = null;
    else if (["comReferencias", "comAltura", "nivel", "soComFicha", "comNomePopular"].includes(chip.grupo)) novo[chip.grupo] = null;
    else novo[chip.grupo] = novo[chip.grupo].filter(v => v !== chip.valor);
    return novo;
}

export const ORDENACOES = {
    nome: "Nome popular (A–Z)",
    cientifico: "Nome científico (A–Z)",
    altura_asc: "Altura (menor → maior)",
    altura_desc: "Altura (maior → menor)",
    familia: "Família"
};

/** Ordena uma cópia; quem não tem a informação (altura, família) fica no fim. */
export function ordenar(especies, criterio = "nome") {
    const texto = (a, b) => (a ?? "").localeCompare(b ?? "", "pt-BR");
    const porNome = (a, b) => texto(a.nome_popular, b.nome_popular);
    const altura = e => atributosDe(e).alturaMax;
    const comAltura = (sinal) => (a, b) => {
        const x = altura(a), y = altura(b);
        if (x === null && y === null) return porNome(a, b);
        if (x === null) return 1;
        if (y === null) return -1;
        return sinal * (x - y) || porNome(a, b);
    };
    const comparadores = {
        nome: porNome,
        cientifico: (a, b) => texto(a.nome_cientifico, b.nome_cientifico) || porNome(a, b),
        altura_asc: comAltura(1),
        altura_desc: comAltura(-1),
        familia: (a, b) => (a.familia && !b.familia ? -1 : !a.familia && b.familia ? 1 : texto(a.familia, b.familia)) || porNome(a, b)
    };
    return [...especies].sort(comparadores[criterio] ?? porNome);
}
