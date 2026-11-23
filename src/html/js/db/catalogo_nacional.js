import { plantaTerraDB } from "./plantaterra_db.js";
import { FORMATO_CATALOGO, PREFIXO_ID, linhaDeRegistro, registroDeLinha } from "../dominio/catalogo_nacional.js";
import { normalizarNome } from "../dominio/biblioteca_plantas.js";
import { baixarArquivo } from "./util_arquivo.js";
import { aplicarFicha, semFicha } from "../dominio/biblioteca_unificada.js";
import { listarFichas, reconciliarPropriasComCatalogo } from "./biblioteca.js";

/**
 * Catálogo nacional (docs/especificacao.md §15.2): ~58 mil espécies de referência no store `catalogo`.
 * Tudo aqui é pensado para não carregar o store inteiro na memória: importação em streaming e em lotes,
 * listagem paginada por cursor (keyset) e busca por índice de palavras.
 */

const TAMANHO_LOTE = 1500;
const MAXIMO_CANDIDATOS = 4000;
const MAXIMO_RESULTADOS_BUSCA = 600;

const esperar = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const banco = () => plantaTerraDB._banco();

const CHAVE_CABECALHO = "plantaterra.catalogo_nacional.cabecalho";

/** Dados da fonte do último catálogo importado (citação, versão, data) — a licença exige citar o JBRJ. */
export function cabecalhoDoCatalogo() {
    try {
        return JSON.parse(localStorage.getItem(CHAVE_CABECALHO));
    } catch {
        return null;
    }
}

export async function contarCatalogo() {
    const b = await banco();
    return esperar(b.transaction("catalogo", "readonly").objectStore("catalogo").count());
}

export async function limparCatalogo() {
    const b = await banco();
    localStorage.removeItem(CHAVE_CABECALHO);
    return esperar(b.transaction("catalogo", "readwrite").objectStore("catalogo").clear());
}

export async function obterTaxon(id) {
    const b = await banco();
    return esperar(b.transaction("catalogo", "readonly").objectStore("catalogo").get(id));
}

/** Linhas de texto de um stream de bytes (gzip detectado pelos 2 primeiros bytes), sem ler o arquivo todo. */
async function* linhasDoArquivo(arquivo) {
    const cabeca = new Uint8Array(await arquivo.slice(0, 2).arrayBuffer());
    let fluxo = arquivo.stream();
    if (cabeca[0] === 0x1f && cabeca[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") throw new Error("este navegador não descompacta .gz — use o arquivo .jsonl.");
        fluxo = fluxo.pipeThrough(new DecompressionStream("gzip"));
    }
    const leitor = fluxo.pipeThrough(new TextDecoderStream("utf-8")).getReader();
    let resto = "";
    for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        resto += value;
        let indice;
        let inicio = 0;
        while ((indice = resto.indexOf("\n", inicio)) >= 0) {
            const linha = resto.slice(inicio, indice).trim();
            inicio = indice + 1;
            if (linha) yield linha;
        }
        resto = resto.slice(inicio);
    }
    if (resto.trim()) yield resto.trim();
}

async function gravarLote(registros) {
    const b = await banco();
    await new Promise((resolve, reject) => {
        const transacao = b.transaction("catalogo", "readwrite");
        const store = transacao.objectStore("catalogo");
        registros.forEach(r => store.put(r));
        transacao.oncomplete = resolve;
        transacao.onerror = () => reject(transacao.error);
        transacao.onabort = () => reject(transacao.error);
    });
}

/** Arquivo do catálogo nacional (.jsonl ou .jsonl.gz) → store. Reimportar atualiza pelo id, sem duplicar. */
export function ehArquivoDeCatalogoNacional(arquivo) {
    return /\.jsonl(\.gz)?$/i.test(arquivo?.name ?? "");
}

export async function importarCatalogoNacional(arquivo, aoProgredir = () => {}) {
    const resumo = { importadas: 0, invalidas: 0, fichasFundidas: 0 };
    // Quem já tem ficha (ou é espécie própria) não pode ser sobrescrito pelo táxon: a ficha acompanha o registro novo.
    const fichas = new Map((await listarFichas()).map(r => [r.id, r]));
    let lote = [];
    let primeira = true;
    for await (const texto of linhasDoArquivo(arquivo)) {
        let linha;
        try {
            linha = JSON.parse(texto);
        } catch {
            if (primeira) throw new Error("o arquivo não é um catálogo nacional (JSON por linha).");
            resumo.invalidas++;
            continue;
        }
        if (primeira) {
            primeira = false;
            if (linha.formato !== FORMATO_CATALOGO) throw new Error("o arquivo não é um catálogo nacional do PlantaTerra.");
            if (linha.formato_versao > 2) throw new Error(`catálogo de uma versão mais nova do formato (${linha.formato_versao}) — atualize o app.`);
            localStorage.setItem(CHAVE_CABECALHO, JSON.stringify(linha));
            continue;
        }
        const novo = registroDeLinha(linha);
        if (!novo) { resumo.invalidas++; continue; }
        const antigo = fichas.get(novo.id);
        lote.push(antigo ? aplicarFicha(novo, antigo.ficha, { substituir: true, editada: !!antigo.ficha_editada }) : novo);
        if (lote.length >= TAMANHO_LOTE) {
            await gravarLote(lote);
            resumo.importadas += lote.length;
            lote = [];
            aoProgredir(resumo.importadas);
        }
    }
    if (lote.length) {
        await gravarLote(lote);
        resumo.importadas += lote.length;
        aoProgredir(resumo.importadas);
    }
    // Fichas importadas antes do catálogo, sem id de catálogo (próprias), se fundem ao táxon do mesmo nome científico.
    resumo.fichasFundidas = await reconciliarPropriasComCatalogo();
    return resumo;
}

function passaNosFiltros(taxon, filtros) {
    // Quem tem ficha completa passa por qualquer nível: a ficha é o que a pessoa quer achar (ex.: uma subespécie da Embrapa).
    if (filtros.nivel && taxon.nv !== filtros.nivel && !taxon.rica) return false;
    if (filtros.forma && !taxon.v?.includes(filtros.forma)) return false;
    if (filtros.comPopular && !taxon.p?.length) return false;
    if (filtros.excluirRicas && taxon.rica) return false;
    if (filtros.predicado && !filtros.predicado(taxon)) return false;
    if (filtros.origem && taxon.o !== filtros.origem) return false;
    if (filtros.uf && !taxon.uf?.includes(filtros.uf)) return false;
    if (filtros.reino && taxon.r !== filtros.reino) return false;
    return true;
}

/**
 * Uma página do catálogo em ordem alfabética do nome científico, por cursor (a próxima página continua de
 * onde a anterior parou — não reconta nem pula registros, ao contrário de "offset").
 * @param {{reino?:string, origem?:string, uf?:string}} filtros
 * @param {{chave:any, id:string}|null} depois  `proximo` da página anterior
 * @returns {Promise<{ itens: object[], proximo: {chave:any, id:string}|null }>}
 */
export async function listarCatalogo({ filtros = {}, depois = null, limite = 50 } = {}) {
    const b = await banco();
    const store = b.transaction("catalogo", "readonly").objectStore("catalogo");
    // O índice mais específico que cobre os filtros; o que sobrar é conferido registro a registro.
    let nomeIndice = "index_cientifico";
    let faixa = null;
    const restantes = { ...filtros };
    if (filtros.nivel && filtros.reino) {
        nomeIndice = "index_nivel_reino_cientifico";
        faixa = IDBKeyRange.bound([filtros.nivel, filtros.reino, ""], [filtros.nivel, filtros.reino, "\uffff"]);
        delete restantes.nivel; delete restantes.reino;
    } else if (filtros.nivel) {
        nomeIndice = "index_nivel_cientifico";
        faixa = IDBKeyRange.bound([filtros.nivel, ""], [filtros.nivel, "\uffff"]);
        delete restantes.nivel;
    }
    const indice = store.index(nomeIndice);
    const filtrosRestantes = restantes;

    return new Promise((resolve, reject) => {
        const itens = [];
        let ultimo = null;
        const request = indice.openCursor(depois ? (faixa ? IDBKeyRange.bound(depois.chave, faixa.upper) : IDBKeyRange.lowerBound(depois.chave)) : faixa);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve({ itens, proximo: null });
            // Aberto em `depois.chave` (inclusive): pula o que já foi entregue — mesma chave e id ≤ ao último.
            if (depois && indexedDB.cmp(cursor.key, depois.chave) === 0 && indexedDB.cmp(cursor.primaryKey, depois.id) <= 0) {
                cursor.continue();
                return;
            }
            if (passaNosFiltros(cursor.value, filtrosRestantes)) {
                itens.push(cursor.value);
                ultimo = { chave: cursor.key, id: cursor.primaryKey };
                if (itens.length >= limite) return resolve({ itens, proximo: ultimo });
            }
            cursor.continue();
        };
    });
}

/** Pontuação de relevância (menor = melhor): nome científico exato, nome popular exato, começos e o resto. */
function relevancia(taxon, consulta) {
    if (taxon.cn === consulta) return 0;
    const populares = taxon.p?.map(normalizarNome) ?? [];
    if (populares.includes(consulta)) return 1;
    if (taxon.cn.startsWith(consulta)) return 2;
    if (populares.some(nome => normalizarNome(nome).startsWith(consulta))) return 3;
    return 4;
}

const obter = (store, id) => esperar(store.get(id));

/**
 * Busca por palavras (cada palavra digitada precisa ser o começo de alguma palavra do nome científico ou dos
 * nomes populares). O índice resolve a palavra mais longa; as demais filtram os candidatos.
 * Na visão "espécies" um SINÔNIMO que bate com a busca aparece como o nome aceito dele (`_via` guarda o
 * sinônimo achado) — quem procura "Tabebuia impetiginosa" encontra "Handroanthus impetiginosus".
 * @returns {Promise<{ itens: object[], truncado: boolean }>}
 */
export async function buscarCatalogo(texto, { filtros = {}, limite = MAXIMO_RESULTADOS_BUSCA } = {}) {
    const consulta = normalizarNome(texto);
    const palavras = consulta.split(/[^a-z0-9]+/).filter(Boolean);
    const guia = palavras.filter(p => p.length >= 2).sort((a, b) => b.length - a.length)[0];
    if (!guia) return { itens: [], truncado: false };

    const b = await banco();
    const store = b.transaction("catalogo", "readonly").objectStore("catalogo");
    const ids = await new Promise((resolve, reject) => {
        const achados = new Set();
        const request = store.index("index_busca").openKeyCursor(IDBKeyRange.bound(guia, guia + "\uffff"));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor || achados.size >= MAXIMO_CANDIDATOS) return resolve(achados);
            achados.add(cursor.primaryKey);
            cursor.continue();
        };
    });

    const visaoEspecies = filtros.nivel === "especie";
    const registros = await Promise.all([...ids].map(id => obter(store, id)));
    const achados = registros
        .filter(t => t && palavras.every(p => t.busca.some(token => token.startsWith(p))))
        .map(t => ({ t, pontos: relevancia(t, consulta) }))
        .filter(({ t }) => (visaoEspecies && t.nv === "sinonimo") || passaNosFiltros(t, filtros));

    const vistos = new Set();
    const itens = [];
    for (const { t, pontos } of achados.sort((x, y) => x.pontos - y.pontos || (y.t.rica ? 1 : 0) - (x.t.rica ? 1 : 0) || x.t.cn.localeCompare(y.t.cn))) {
        let resultado = t;
        if (visaoEspecies && t.nv === "sinonimo") {
            const aceito = t.ai ? await obter(store, t.ai) : null;
            if (!aceito || !passaNosFiltros(aceito, filtros)) continue;
            resultado = { ...aceito, _via: t.c };
        }
        if (vistos.has(resultado.id)) continue;
        vistos.add(resultado.id);
        itens.push(resultado);
    }
    return { itens: itens.slice(0, limite), truncado: ids.size >= MAXIMO_CANDIDATOS || itens.length > limite };
}

/** Reinos presentes no catálogo (para os filtros da tela), sem varrer o store inteiro. */
export async function listarReinos() {
    const b = await banco();
    const indice = b.transaction("catalogo", "readonly").objectStore("catalogo").index("index_nivel_reino_cientifico");
    return new Promise((resolve, reject) => {
        const reinos = [];
        const request = indice.openKeyCursor(IDBKeyRange.bound(["especie"], ["especie", []]));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve(reinos);
            const reino = cursor.key[1];
            reinos.push(reino);
            // Salta para o próximo reino em vez de varrer as chaves de todas as espécies.
            cursor.continue(["especie", reino, "\uffff"]);
        };
    });
}

// ---- navegação entre registros (§15.2) ----

const todosDoIndice = (store, indice, chave, limite) => esperar(store.index(indice).getAll(chave, limite));

/**
 * Tudo que a tela de detalhe precisa de um táxon, resolvido de uma vez: o nome aceito (se for sinônimo), a
 * hierarquia acima (gênero → família → …), os filhos, os sinônimos, os nomes que o têm como original e as
 * relações nomenclaturais com o outro lado já carregado. Listas longas vêm cortadas, com a contagem total.
 */
export async function contextoDoTaxon(id, { limiteLista = 60 } = {}) {
    const b = await banco();
    const store = b.transaction("catalogo", "readonly").objectStore("catalogo");
    const taxon = await obter(store, id);
    if (!taxon) return null;

    const ancestrais = [];
    for (let atual = taxon, passos = 0; atual.pi && passos < 12; passos++) {
        atual = await obter(store, atual.pi);
        if (!atual) break;
        ancestrais.unshift(atual);
    }
    const [aceito, original, filhos, totalFilhos, sinonimos, totalSinonimos, derivados] = await Promise.all([
        taxon.ai ? obter(store, taxon.ai) : null,
        taxon.oi ? obter(store, taxon.oi) : null,
        todosDoIndice(store, "index_pai", id, limiteLista),
        esperar(store.index("index_pai").count(id)),
        todosDoIndice(store, "index_aceito", id, limiteLista),
        esperar(store.index("index_aceito").count(id)),
        todosDoIndice(store, "index_original", id, limiteLista)
    ]);
    const relacionadas = await Promise.all((taxon.rel ?? []).slice(0, 200).map(async ([outro, tipo]) => ({ tipo, taxon: await obter(store, outro) })));
    const porNome = (x, y) => x.cn.localeCompare(y.cn);
    return {
        taxon, ancestrais, aceito, original,
        filhos: filhos.sort(porNome), totalFilhos,
        sinonimos: sinonimos.sort(porNome), totalSinonimos,
        derivados: derivados.filter(d => d.id !== id).sort(porNome),
        relacionadas: relacionadas.filter(r => r.taxon)
    };
}

/**
 * Exporta o catálogo importado no mesmo formato do arquivo de origem (`.jsonl.gz`), para repassar a outras
 * pessoas: reimportá-lo reconstrói o store igual. Lê por cursor, em lotes, e compacta com `CompressionStream`.
 * @returns {Promise<number>} quantidade de espécies exportadas
 */
export async function exportarCatalogoNacional() {
    const b = await banco();
    const partes = [JSON.stringify({
        ...(cabecalhoDoCatalogo() ?? { fonte: "Flora e Funga do Brasil (JBRJ), CC BY 4.0." }),
        formato: FORMATO_CATALOGO, formato_versao: 2, exportado_em: new Date().toISOString()
    }) + "\n"];
    let quantidade = 0;
    await new Promise((resolve, reject) => {
        const request = b.transaction("catalogo", "readonly").objectStore("catalogo").openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve();
            // O arquivo do catálogo é só o catálogo: sem as fichas (elas têm exportação própria) e sem espécies próprias.
            if (!cursor.value.propria) {
                partes.push(JSON.stringify(linhaDeRegistro(semFicha(cursor.value))) + "\n");
                quantidade++;
            }
            cursor.continue();
        };
    });
    if (quantidade === 0) return 0;

    const texto = new Blob(partes, { type: "application/x-ndjson" });
    const data = new Date().toISOString().slice(0, 10);
    if (typeof CompressionStream === "undefined") {
        baixarArquivo(texto, `plantaterra-catalogo-nacional-${data}.jsonl`, "application/x-ndjson");
    } else {
        const comprimido = await new Response(texto.stream().pipeThrough(new CompressionStream("gzip"))).blob();
        baixarArquivo(comprimido, `plantaterra-catalogo-nacional-${data}.jsonl.gz`, "application/gzip");
    }
    return quantidade;
}
