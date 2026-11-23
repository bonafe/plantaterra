import { plantaTerraDB } from "./plantaterra_db.js";
import { chaveEspecie, normalizarNome } from "../dominio/biblioteca_plantas.js";
import { PREFIXO_ID } from "../dominio/catalogo_nacional.js";
import {
    aplicarFicha, fichaDeBruta, instantaneoParaBackup, registroDeInstantaneo, registroProprio, registroProvisorio, semFicha
} from "../dominio/biblioteca_unificada.js";

/**
 * Operações da biblioteca única (docs/especificacao.md §15): registros do store `catalogo` — táxons do catálogo nacional,
 * com `ficha` quando a espécie tem dados ricos. Importar fichas, criar/editar/remover uma ficha, e o que o projeto precisa
 * (instantâneos para o backup, religar plantas).
 */

const esperar = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
const banco = () => plantaTerraDB._banco();

async function abrir(modo = "readonly") {
    return (await banco()).transaction("catalogo", modo);
}

export async function obterRegistro(id) {
    return esperar((await abrir()).objectStore("catalogo").get(id));
}

/** Map id → registro (só os que existem). */
export async function obterRegistros(ids) {
    const store = (await abrir()).objectStore("catalogo");
    const achados = await Promise.all([...new Set(ids.filter(Boolean))].map(async id => [id, await esperar(store.get(id))]));
    return new Map(achados.filter(([, registro]) => registro));
}

/** Todos os registros com ficha completa (poucas centenas): é o conjunto onde valem os filtros de altura, função, foto… */
export async function listarFichas() {
    return esperar((await abrir()).objectStore("catalogo").index("index_rica").getAll());
}

export async function contarFichas() {
    return esperar((await abrir()).objectStore("catalogo").index("index_rica").count());
}

/** O registro do catálogo que corresponde a uma ficha: pelo id do catálogo, senão pelo nome científico (sinônimo → aceito). */
async function encontrarAlvo(store, ficha) {
    if (typeof ficha.catalogo_id === "string") {
        const direto = await esperar(store.get(ficha.catalogo_id));
        if (direto) return direto;
    }
    const cn = normalizarNome(ficha.nome_cientifico ?? "");
    if (!cn) return null;
    const candidatos = await esperar(store.index("index_cientifico").getAll(IDBKeyRange.only(cn)));
    const aceito = candidatos.find(r => r.st === "A" && r.k === "sp" && !r.propria) ?? candidatos.find(r => r.k === "sp" && r.st !== "S" && !r.propria);
    if (aceito) return aceito;
    const sinonimo = candidatos.find(r => r.st === "S" && r.ai);
    if (sinonimo) {
        const doSinonimo = await esperar(store.get(sinonimo.ai));
        if (doSinonimo) return doSinonimo;
    }
    return candidatos.find(r => r.propria) ?? null;
}

/**
 * Importa fichas (já mapeadas para o formato de espécie): cada uma vai para o registro do táxon correspondente, ou vira um
 * registro próprio. A ficha importada de um arquivo SUBSTITUI a que já veio do mesmo arquivo (é assim que uma nova versão do
 * arquivo atualiza fotos e textos) e só COMPLETA o que falta numa ficha de outro arquivo ou editada pela pessoa.
 * @param {string|null} origem  nome do arquivo/pacote de onde vêm as fichas
 * @returns {{adicionadas, atualizadas, complementadas, preservadas, invalidas, idPorChave: Map}} `idPorChave`: chaveEspecie → id do registro
 */
export async function mesclarFichas(lista, aoProgredir = () => {}, origem = null) {
    const resumo = { adicionadas: 0, atualizadas: 0, complementadas: 0, preservadas: 0, invalidas: 0, idPorChave: new Map() };
    const TAMANHO_LOTE = 25;
    for (let inicio = 0; inicio < lista.length; inicio += TAMANHO_LOTE) {
        const transacao = await abrir("readwrite");
        const store = transacao.objectStore("catalogo");
        for (const bruta of lista.slice(inicio, inicio + TAMANHO_LOTE)) {
            const ficha = fichaDeBruta(bruta);
            if (!ficha) { resumo.invalidas++; continue; }
            const alvo = await encontrarAlvo(store, ficha);
            let registro;
            if (!alvo) {
                registro = typeof ficha.catalogo_id === "string" && ficha.catalogo_id.startsWith(PREFIXO_ID)
                    ? registroProvisorio(ficha.catalogo_id, ficha)
                    : registroProprio(ficha, plantaTerraDB.gerarId());
                if (origem) registro.ficha_origem = origem;
                resumo.adicionadas++;
            } else if (!alvo.ficha) {
                registro = aplicarFicha(alvo, ficha, { substituir: true, origem });
                resumo.adicionadas++;
            } else if (alvo.ficha_editada) {
                registro = aplicarFicha(alvo, ficha, { substituir: false });
                resumo.preservadas++;
            } else if (!alvo.ficha_origem || alvo.ficha_origem === origem) {
                registro = aplicarFicha(alvo, ficha, { substituir: true, origem });
                resumo.atualizadas++;
            } else {
                registro = aplicarFicha(alvo, ficha, { substituir: false });
                resumo.complementadas++;
            }
            await esperar(store.put(registro));
            resumo.idPorChave.set(chaveEspecie(ficha.nome_popular, ficha.nome_cientifico), registro.id);
        }
        await new Promise(resolve => { transacao.oncomplete = resolve; });
        aoProgredir(Math.min(inicio + TAMANHO_LOTE, lista.length));
    }
    return resumo;
}

/** A pessoa salvou o formulário: a ficha vira a que ela preencheu (e passa a contar como editada). */
export async function salvarFicha(id, ficha) {
    const transacao = await abrir("readwrite");
    const store = transacao.objectStore("catalogo");
    const registro = await esperar(store.get(id));
    if (!registro) throw new Error("espécie não encontrada na biblioteca.");
    const novo = aplicarFicha(registro, ficha, { substituir: true, editada: true });
    await esperar(store.put(novo));
    return novo;
}

/** Espécie criada pela pessoa, sem correspondência no catálogo. */
export async function criarEspecieProria(ficha) {
    const registro = { ...registroProprio(ficha, plantaTerraDB.gerarId()), ficha_editada: 1 };
    await esperar((await abrir("readwrite")).objectStore("catalogo").put(registro));
    return registro;
}

/** Tira a ficha de um táxon do catálogo (ele continua lá); espécie própria some de vez. */
export async function removerFicha(id) {
    const store = (await abrir("readwrite")).objectStore("catalogo");
    const registro = await esperar(store.get(id));
    if (!registro) return;
    if (registro.propria) await esperar(store.delete(id));
    else await esperar(store.put(semFicha(registro)));
}

/** Plantas dos projetos que apontavam para `idAntigo` passam a apontar para o novo (quando duas fichas se fundem). */
export async function religarPlantas(mapaDeIds) {
    if (!mapaDeIds.size) return;
    const transacao = (await banco()).transaction("planta_linha", "readwrite");
    await new Promise((resolve, reject) => {
        const cursor = transacao.objectStore("planta_linha").openCursor();
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
            const atual = cursor.result;
            if (!atual) return resolve();
            const novo = mapaDeIds.get(atual.value.especie_id);
            if (novo) atual.update({ ...atual.value, especie_id: novo });
            atual.continue();
        };
    });
}

/**
 * Depois de importar o catálogo: espécies próprias (importadas antes dele) que correspondem a um táxon dele são
 * fundidas no táxon, e as plantas dos projetos se religam.
 * @returns {Promise<number>} quantas foram fundidas
 */
export async function reconciliarPropriasComCatalogo() {
    const transacao = await abrir("readwrite");
    const store = transacao.objectStore("catalogo");
    const proprias = (await esperar(store.index("index_rica").getAll())).filter(r => r.propria && !r.sem_cientifico);
    const mapa = new Map();
    for (const propria of proprias) {
        const alvo = await encontrarAlvo(store, { nome_cientifico: propria.c });
        if (!alvo || alvo.id === propria.id || alvo.propria) continue;
        const fundido = aplicarFicha(alvo, propria.ficha, { substituir: !alvo.ficha, editada: !!propria.ficha_editada });
        await esperar(store.put(fundido));
        await esperar(store.delete(propria.id));
        mapa.set(propria.id, alvo.id);
    }
    await new Promise(resolve => { transacao.oncomplete = resolve; });
    await religarPlantas(mapa);
    return mapa.size;
}

// ---- projeto: o backup leva só as espécies que o projeto usa ----

/** Instantâneos leves (só a foto de capa) das espécies de uma lista de ids. */
export async function instantaneosDasEspecies(ids) {
    const registros = await obterRegistros(ids);
    return [...registros.values()].map(instantaneoParaBackup);
}

/**
 * Espécies que vieram num backup de projeto entram na biblioteca: o que falta é criado (mesmo sem o catálogo
 * importado); o que já existe fica como está, só ganhando a ficha se não tinha.
 */
export async function incorporarInstantaneos(instantaneos) {
    const transacao = await abrir("readwrite");
    const store = transacao.objectStore("catalogo");
    for (const instantaneo of instantaneos) {
        if (!instantaneo?.id || typeof instantaneo.c !== "string") continue;
        const existente = await esperar(store.get(instantaneo.id));
        if (!existente) await esperar(store.put(registroDeInstantaneo(instantaneo)));
        else if (!existente.ficha && instantaneo.ficha) await esperar(store.put(aplicarFicha(existente, instantaneo.ficha, { substituir: true })));
    }
    await new Promise(resolve => { transacao.oncomplete = resolve; });
}
