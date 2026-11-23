/**
 * Regras puras do catálogo nacional (docs/especificacao.md §15.2): a linha do arquivo `03_catalogo_nacional.jsonl.gz` →
 * registro armazenado (com campos de busca) → ficha no formato da biblioteca. Não conhece banco nem tela.
 *
 * Um registro por TÁXON (qualquer nível, aceito ou sinônimo). Chaves curtas (todas opcionais menos id e c):
 *   id, c nome científico sem autoria, a autoria, k nível taxonômico (RANGOS), st status ("A" aceito | "S" sinônimo),
 *   ns status nomenclatural, ai id do nome aceito, pi id do pai (gênero → família…), oi id do nome original (basiônimo),
 *   pub/ano publicação do nome, md modificado em, f família, r reino, fi filo, cl classe, or ordem, g gênero,
 *   p nomes populares (pt), pv {nome: região}, n nomes em outros idiomas {idioma: [nomes]}, o origem,
 *   uf/ufn/ufe estados (todos/nativa/exótica), d domínios fitogeográficos, e endemismo, v forma de vida, h habitat,
 *   vg vegetação, rel [[id, tipo]] relações nomenclaturais (RELACOES), rf [[citação, título, autor, data, tipo, id]]
 *   referências, tp [[status, herbário, nº catálogo, local, coletor, fonte]] espécimes-tipo.
 * Campos desconhecidos (de versões futuras do arquivo) são guardados como vieram.
 */
import { normalizarNome } from "./biblioteca_plantas.js";
import { UFS_VALIDAS } from "./estados_brasil.js";

export const FORMATO_CATALOGO = "plantaterra-catalogo-nacional";
export const PREFIXO_ID = "jbrj-";

export const RANGOS = {
    sp: "Espécie", var: "Variedade", ssp: "Subespécie", f: "Forma", gen: "Gênero", fam: "Família", ord: "Ordem",
    cla: "Classe", tri: "Tribo", div: "Divisão", sfam: "Subfamília"
};

/** Relações nomenclaturais entre nomes (rótulo lido do ponto de vista do registro que as guarda). */
export const RELACOES = {
    sb: "É sinônimo (basiônimo) de", sh: "É sinônimo (homotípico) de", sx: "É sinônimo (heterotípico) de",
    tb: "Tem como sinônimo (basiônimo)", th: "Tem como sinônimo (homotípico)", tx: "Tem como sinônimo (heterotípico)",
    "?": "Relacionado a"
};

export const NIVEIS = { especie: "Espécies", infra: "Variedades e subespécies", sinonimo: "Sinônimos", genero: "Gêneros", superior: "Famílias e acima" };

/** Nível de listagem de um registro: o que decide em qual "visão" do catálogo ele aparece. */
export function nivelDe(registro) {
    if (registro.st === "S") return "sinonimo";
    switch (registro.k ?? "sp") {
        case "sp": return "especie";
        case "var": case "ssp": case "f": return "infra";
        case "gen": return "genero";
        default: return "superior";
    }
}

/** Palavras de busca (sem acento, ≥ 2 letras) do nome científico e dos nomes populares. */
export function tokensDeBusca(linha) {
    const textos = [linha.c, ...(linha.p ?? []), ...(linha.s ?? [])];
    const tokens = new Set();
    for (const texto of textos) {
        for (const palavra of normalizarNome(texto).split(/[^a-z0-9]+/)) {
            if (palavra.length >= 2) tokens.add(palavra);
        }
    }
    return [...tokens];
}

const comPrefixo = id => (id ? PREFIXO_ID + id : undefined);
const RESERVADAS = new Set(["cn", "nv", "busca"]);

/** Linha do arquivo → registro do store `catalogo`; null se não tiver id e nome científico. */
export function registroDeLinha(linha) {
    if (!linha || typeof linha !== "object" || typeof linha.c !== "string" || !linha.c.trim() || !linha.id) return null;
    const registro = {};
    for (const [chave, valor] of Object.entries(linha)) {
        if (!RESERVADAS.has(chave) && valor !== null && valor !== undefined && valor !== "") registro[chave] = valor;
    }
    registro.id = PREFIXO_ID + linha.id;
    registro.c = linha.c.trim();
    for (const chave of ["ai", "pi", "oi"]) {
        if (registro[chave]) registro[chave] = comPrefixo(registro[chave]);
    }
    if (Array.isArray(registro.rel)) registro.rel = registro.rel.map(([id, tipo]) => [comPrefixo(id), tipo]);
    if (registro.uf) registro.uf = registro.uf.filter(uf => UFS_VALIDAS.has(uf));
    // Arquivo v1 (só espécies aceitas) não tinha nível nem status.
    registro.k ??= "sp";
    if (linha.k === undefined && linha.st === undefined) registro.st = "A";
    registro.r = typeof linha.r === "string" && linha.r ? linha.r : "—";
    registro.cn = normalizarNome(registro.c);
    registro.nv = nivelDe(registro);
    registro.busca = tokensDeBusca(registro);
    return registro;
}

/** Registro armazenado → linha do arquivo (o inverso de `registroDeLinha`: sem campos de busca, ids sem prefixo). */
export function linhaDeRegistro(registro) {
    const { cn, nv, busca, ...linha } = registro;
    const semPrefixo = id => (typeof id === "string" && id.startsWith(PREFIXO_ID) ? id.slice(PREFIXO_ID.length) : id);
    linha.id = semPrefixo(linha.id);
    for (const chave of ["ai", "pi", "oi"]) if (linha[chave]) linha[chave] = semPrefixo(linha[chave]);
    if (linha.rel) linha.rel = linha.rel.map(([id, tipo]) => [semPrefixo(id), tipo]);
    if (linha.r === "—") delete linha.r;
    return linha;
}

/** Registro do catálogo → objeto no formato de espécie da biblioteca (exibição e "adicionar à minha biblioteca"). */
export function especieDeTaxon(taxon) {
    const populares = taxon.p ?? [];
    const doCatalogo = taxon.id.startsWith(PREFIXO_ID);
    const rotuloLista = lista => lista?.join(", ");
    const ocorrencia = [
        taxon.uf?.length ? `Ocorre em ${taxon.uf.join(", ")}.` : null,
        taxon.d?.length ? `Domínios fitogeográficos: ${rotuloLista(taxon.d)}.` : null,
        taxon.e?.length ? `Endemismo: ${rotuloLista(taxon.e)}.` : null
    ].filter(Boolean).join(" ") || null;
    const extras = {};
    if (taxon.h) extras["atributos.habitat"] = taxon.h;
    if (taxon.vg) extras["atributos.tipos_de_vegetacao"] = taxon.vg;
    if (taxon.n) extras["atributos.nomes_outros_idiomas"] = taxon.n;
    for (const [rotulo, chave] of [["reino", "r"], ["filo", "fi"], ["classe", "cl"], ["ordem", "or"]]) {
        if (taxon[chave] && taxon[chave] !== "—") extras[`taxonomia.${rotulo}`] = taxon[chave];
    }
    return {
        // Sem nome popular, o nome científico faz o papel de nome principal (a biblioteca exige um).
        nome_popular: populares[0] ?? taxon.c,
        nomes_populares: populares,
        nome_cientifico: taxon.c,
        autoria: taxon.a ?? null,
        familia: taxon.f ?? null,
        sinonimos: taxon.s ?? [],
        origem: taxon.o ?? null,
        forma_de_vida: taxon.v?.join(", ") ?? null,
        ocorrencia_texto: ocorrencia,
        ocorrencia_estados: taxon.uf ?? [],
        ocorrencia_precisao: "lista de estados da Flora e Funga do Brasil (JBRJ); sem polígonos",
        extras,
        fontes: doCatalogo ? [`http://reflora.jbrj.gov.br/reflora/listaBrasil/FichaPublicaTaxonUC/FichaPublicaTaxonUC.do?id=FB${taxon.id.slice(PREFIXO_ID.length)}`] : [],
        notas: doCatalogo ? "Flora e Funga do Brasil (JBRJ), nome aceito; sem curadoria agroflorestal." : null,
        catalogo_id: taxon.id
    };
}
