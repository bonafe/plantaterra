import { DBBase } from "./db_base.js";
import { aplicarFicha, fichaDeBruta, registroProprio } from "../dominio/biblioteca_unificada.js";
import { normalizarNome } from "../dominio/biblioteca_plantas.js";
import { nomePadraoDaEstacao } from "../dominio/nivelamento.js";

const NOME_BANCO = "PlantaTerraDB";
const VERSAO = 7;

const funcoesDeMigracao = [
    banco => {
        const osProjeto = banco.createObjectStore("projeto", { keyPath: "id" });
        osProjeto.createIndex("index_nome", "nome", { unique: false });

        const osTrilha = banco.createObjectStore("trilha_perimetro", { keyPath: "id" });
        osTrilha.createIndex("index_projeto_id", "projeto_id", { unique: false });

        const osEstacao = banco.createObjectStore("estacao_nivel", { keyPath: "id" });
        osEstacao.createIndex("index_projeto_id", "projeto_id", { unique: false });

        const osLeitura = banco.createObjectStore("leitura_nivel", { keyPath: "id" });
        osLeitura.createIndex("index_estacao_id", "estacao_id", { unique: false });
    },
    banco => {
        const osSaf = banco.createObjectStore("saf", { keyPath: "id" });
        osSaf.createIndex("index_projeto_id", "projeto_id", { unique: false });

        const osLinha = banco.createObjectStore("linha_plantio", { keyPath: "id" });
        osLinha.createIndex("index_saf_id", "saf_id", { unique: false });
        osLinha.createIndex("index_projeto_id", "projeto_id", { unique: false });

        const osPlanta = banco.createObjectStore("planta_linha", { keyPath: "id" });
        osPlanta.createIndex("index_linha_id", "linha_id", { unique: false });
    },
    banco => {
        const osContexto = banco.createObjectStore("elemento_contexto", { keyPath: "id" });
        osContexto.createIndex("index_projeto_id", "projeto_id", { unique: false });
    },
    banco => {
        const osEspecie = banco.createObjectStore("especie", { keyPath: "id" });
        osEspecie.createIndex("index_nome_popular", "nome_popular", { unique: false });
    },
    banco => {
        // v5 (nunca publicada com dados): primeira forma do catálogo, só espécies. A v6 a substitui.
        banco.createObjectStore("catalogo", { keyPath: "id" });
    },
    banco => {
        // Catálogo nacional (dado de referência importado, ~166 mil táxons — ver §15.2). É regenerável a partir do
        // arquivo, então a v6 recria o store em vez de migrar registros. Os índices servem à listagem paginada por
        // nível (espécie, sinônimo, gênero…) e reino, à busca por palavra e à navegação entre registros.
        if (banco.objectStoreNames.contains("catalogo")) banco.deleteObjectStore("catalogo");
        const osCatalogo = banco.createObjectStore("catalogo", { keyPath: "id" });
        osCatalogo.createIndex("index_cientifico", "cn", { unique: false });
        osCatalogo.createIndex("index_nivel_cientifico", ["nv", "cn"], { unique: false });
        osCatalogo.createIndex("index_nivel_reino_cientifico", ["nv", "r", "cn"], { unique: false });
        osCatalogo.createIndex("index_busca", "busca", { unique: false, multiEntry: true });
        osCatalogo.createIndex("index_pai", "pi", { unique: false });
        osCatalogo.createIndex("index_aceito", "ai", { unique: false });
        osCatalogo.createIndex("index_original", "oi", { unique: false });
        osCatalogo.createIndex("index_familia", "f", { unique: false });
    },
    (banco, transacao) => migrarBibliotecaUnificada(banco, transacao)
];

const pedir = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

/**
 * v7: a biblioteca vira uma só (docs/especificacao.md §15). As espécies do store `especie` (a biblioteca pessoal) passam a
 * ser FICHAS no registro do táxon correspondente do catálogo — achado pelo id do catálogo ou pelo nome científico —, ou
 * registros próprios quando não há correspondência. As plantas dos projetos são religadas ao novo id; no fim o store
 * antigo some. Roda dentro da transação de upgrade (só pedidos do IndexedDB, para ela não fechar no meio).
 */
function migrarBibliotecaUnificada(banco, transacao) {
    const catalogo = transacao.objectStore("catalogo");
    if (!catalogo.indexNames.contains("index_rica")) catalogo.createIndex("index_rica", "rica", { unique: false });
    if (!banco.objectStoreNames.contains("especie")) return;

    (async () => {
        const antigas = await pedir(transacao.objectStore("especie").getAll());
        const novoId = new Map();
        for (const antiga of antigas) {
            const { id, criado_em, atualizado_em, ...resto } = antiga;
            const ficha = fichaDeBruta(resto);
            if (!ficha) continue;
            // O que a pessoa digitou à mão conta como editado (uma importação nova não passa por cima); o que veio de
            // um catálogo (tem fonte ou id de catálogo) pode ser atualizado por uma importação nova.
            const editada = !ficha.fonte_primaria && !ficha.catalogo_id;

            let alvo = typeof ficha.catalogo_id === "string" ? await pedir(catalogo.get(ficha.catalogo_id)) : undefined;
            if (!alvo && ficha.nome_cientifico) {
                const candidatos = await pedir(catalogo.index("index_cientifico").getAll(IDBKeyRange.only(normalizarNome(ficha.nome_cientifico))));
                alvo = candidatos.find(r => r.st === "A" && r.k === "sp") ?? candidatos.find(r => r.st !== "S" && r.k === "sp");
                const sinonimo = alvo ? null : candidatos.find(r => r.st === "S" && r.ai);
                if (sinonimo) alvo = await pedir(catalogo.get(sinonimo.ai));
            }
            const registro = alvo
                ? aplicarFicha(alvo, ficha, { substituir: !alvo.ficha, editada })
                : { ...registroProprio(ficha, id), ...(editada ? { ficha_editada: 1 } : {}) };
            await pedir(catalogo.put(registro));
            if (registro.id !== id) novoId.set(id, registro.id);
        }

        if (novoId.size) {
            await new Promise((resolve, reject) => {
                const cursor = transacao.objectStore("planta_linha").openCursor();
                cursor.onerror = () => reject(cursor.error);
                cursor.onsuccess = () => {
                    const atual = cursor.result;
                    if (!atual) return resolve();
                    const novo = novoId.get(atual.value.especie_id);
                    if (novo) atual.update({ ...atual.value, especie_id: novo });
                    atual.continue();
                };
            });
        }
        banco.deleteObjectStore("especie");
    })().catch(erro => console.error("Migração da biblioteca para o modelo único falhou (o store antigo foi mantido):", erro));
}


class PlantaTerraDB extends DBBase {
    constructor() {
        super(NOME_BANCO, VERSAO, funcoesDeMigracao);
    }

    gerarId() {
        // randomUUID só existe em contexto seguro (HTTPS/localhost); abrindo o app
        // por http://IP-da-rede (teste no celular) ele some — getRandomValues não.
        if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }

    // ---- projeto ----

    async criarProjeto({ nome, descricao = "" }) {
        const agora = Date.now();
        const projeto = {
            id: this.gerarId(),
            nome,
            descricao,
            criado_em: agora,
            atualizado_em: agora
        };
        await this.salvar("projeto", projeto);
        return projeto;
    }

    async atualizarProjeto(projeto) {
        projeto.atualizado_em = Date.now();
        return this.salvar("projeto", projeto);
    }

    async listarProjetos() {
        const projetos = await this.obterTodos("projeto");
        return projetos.sort((a, b) => b.atualizado_em - a.atualizado_em);
    }

    async obterProjeto(id) {
        return this.obterPorChave("projeto", id);
    }

    async excluirProjeto(id) {
        const [trilhas, estacoes, safsComLinhas, elementosContexto] = await Promise.all([
            this.listarTrilhas(id),
            this.listarEstacoes(id),
            this.listarTodasLinhasDoProjeto(id),
            this.listarElementosContexto(id)
        ]);

        const leiturasPorEstacao = await Promise.all(
            estacoes.map(estacao => this.listarLeituras(estacao.id))
        );

        const todasLinhas = safsComLinhas.flatMap(({ linhas }) => linhas);
        const plantasPorLinha = await Promise.all(todasLinhas.map(linha => this.listarPlantasDaLinha(linha.id)));

        await Promise.all([
            this.removerVarios("trilha_perimetro", trilhas.map(t => t.id)),
            this.removerVarios("estacao_nivel", estacoes.map(e => e.id)),
            this.removerVarios("leitura_nivel", leiturasPorEstacao.flat().map(l => l.id)),
            this.removerVarios("saf", safsComLinhas.map(({ saf }) => saf.id)),
            this.removerVarios("linha_plantio", todasLinhas.map(l => l.id)),
            this.removerVarios("planta_linha", plantasPorLinha.flat().map(p => p.id)),
            this.removerVarios("elemento_contexto", elementosContexto.map(e => e.id))
        ]);

        return this.remover("projeto", id);
    }

    // ---- trilha_perimetro ----

    async salvarTrilha(trilha) {
        if (!trilha.id) {
            trilha.id = this.gerarId();
        }
        return this.salvar("trilha_perimetro", trilha);
    }

    async listarTrilhas(projetoId) {
        return this.obterTodos("trilha_perimetro", "index_projeto_id", projetoId);
    }

    async obterTrilha(id) {
        return this.obterPorChave("trilha_perimetro", id);
    }

    async trilhaAtiva(projetoId) {
        const trilhas = await this.listarTrilhas(projetoId);
        return trilhas.find(t => t.ativo) || null;
    }

    async removerTrilha(id) {
        return this.remover("trilha_perimetro", id);
    }

    /** Marca uma rodada de captura já salva como a ativa, desativando as demais do projeto. */
    async definirTrilhaAtiva(projetoId, trilhaId) {
        const trilhas = await this.listarTrilhas(projetoId);
        await Promise.all(trilhas.map(trilha => {
            const deveEstarAtiva = trilha.id === trilhaId;
            if (trilha.ativo === deveEstarAtiva) return null;
            return this.salvar("trilha_perimetro", { ...trilha, ativo: deveEstarAtiva });
        }));
    }

    // ---- estacao_nivel ----

    async criarEstacao({ projetoId, nome = "", coordenada = null, amarradaAEstacaoId = null }) {
        const estacao = {
            id: this.gerarId(),
            projeto_id: projetoId,
            nome: nome || nomePadraoDaEstacao(await this.listarEstacoes(projetoId)),
            coordenada,
            altitude_laser: 0,
            amarrada_a_estacao_id: amarradaAEstacaoId,
            criado_em: Date.now()
        };
        await this.salvar("estacao_nivel", estacao);
        return estacao;
    }

    /** Grava estações e leituras (já recalculadas) numa transação só. */
    async salvarNivelamento(estacoesComLeituras) {
        return this.salvarEmTransacao({
            estacao_nivel: estacoesComLeituras.map(item => item.estacao),
            leitura_nivel: estacoesComLeituras.flatMap(item => item.leituras)
        });
    }

    async listarEstacoes(projetoId) {
        const estacoes = await this.obterTodos("estacao_nivel", "index_projeto_id", projetoId);
        return estacoes.sort((a, b) => a.criado_em - b.criado_em);
    }

    // ---- leitura_nivel ----

    async criarLeitura({ estacaoId, coordenada, alturaMira, ehPontoAmarracao = false }) {
        const leitura = {
            id: this.gerarId(),
            estacao_id: estacaoId,
            coordenada,
            altura_mira: alturaMira,
            eh_ponto_amarracao: ehPontoAmarracao,
            altitude_relativa: null,
            criado_em: Date.now()
        };
        await this.salvar("leitura_nivel", leitura);
        return leitura;
    }

    async listarLeituras(estacaoId) {
        const leituras = await this.obterTodos("leitura_nivel", "index_estacao_id", estacaoId);
        return leituras.sort((a, b) => a.criado_em - b.criado_em);
    }

    async listarTodasLeiturasDoProjeto(projetoId) {
        const estacoes = await this.listarEstacoes(projetoId);
        const listas = await Promise.all(estacoes.map(e => this.listarLeituras(e.id)));
        return estacoes.map((estacao, indice) => ({ estacao, leituras: listas[indice] }));
    }

    // ---- saf ----

    async criarSaf({ projetoId, nome, descricao = "", origem = "manual" }) {
        const agora = Date.now();
        const saf = {
            id: this.gerarId(),
            projeto_id: projetoId,
            nome,
            descricao,
            origem,
            criado_em: agora,
            atualizado_em: agora
        };
        await this.salvar("saf", saf);
        return saf;
    }

    async atualizarSaf(saf) {
        saf.atualizado_em = Date.now();
        return this.salvar("saf", saf);
    }

    async listarSafs(projetoId) {
        const safs = await this.obterTodos("saf", "index_projeto_id", projetoId);
        return safs.sort((a, b) => a.criado_em - b.criado_em);
    }

    async obterSafPorNome(projetoId, nome) {
        const safs = await this.listarSafs(projetoId);
        return safs.find(s => s.nome === nome) || null;
    }

    // ---- linha_plantio ----

    async criarLinha({
        safId,
        projetoId,
        nomeOriginal,
        numeroLinha = null,
        descricao = "",
        metrosLinearesDeclarado = null,
        comprimentoCalculadoM,
        geometria,
        origem = "manual"
    }) {
        const agora = Date.now();
        const linha = {
            id: this.gerarId(),
            saf_id: safId,
            projeto_id: projetoId,
            nome_original: nomeOriginal,
            numero_linha: numeroLinha,
            descricao,
            metros_lineares_declarado: metrosLinearesDeclarado,
            comprimento_calculado_m: comprimentoCalculadoM,
            geometria,
            origem,
            criado_em: agora,
            atualizado_em: agora
        };
        await this.salvar("linha_plantio", linha);
        return linha;
    }

    async atualizarLinha(linha) {
        linha.atualizado_em = Date.now();
        return this.salvar("linha_plantio", linha);
    }

    async listarLinhasDaSaf(safId) {
        const linhas = await this.obterTodos("linha_plantio", "index_saf_id", safId);
        return linhas.sort((a, b) => (a.numero_linha ?? Infinity) - (b.numero_linha ?? Infinity));
    }

    async obterLinha(id) {
        return this.obterPorChave("linha_plantio", id);
    }

    async obterLinhaPorNome(safId, nomeOriginal) {
        const linhas = await this.listarLinhasDaSaf(safId);
        return linhas.find(l => l.nome_original === nomeOriginal) || null;
    }

    async listarTodasLinhasDoProjeto(projetoId) {
        const safs = await this.listarSafs(projetoId);
        const listas = await Promise.all(safs.map(saf => this.listarLinhasDaSaf(saf.id)));
        return safs.map((saf, indice) => ({ saf, linhas: listas[indice] }));
    }

    // ---- planta_linha ----

    async criarPlanta({ linhaId, indiceMetro, especie, especieId = null, quantidade = null, sementes = null, observacao = null, dataPlantio = null }) {
        const planta = {
            id: this.gerarId(),
            linha_id: linhaId,
            indice_metro: indiceMetro,
            especie,
            especie_id: especieId,
            quantidade,
            sementes,
            observacao,
            data_plantio: dataPlantio,
            criado_em: Date.now()
        };
        await this.salvar("planta_linha", planta);
        return planta;
    }

    async atualizarPlanta(planta) {
        await this.salvar("planta_linha", planta);
        return planta;
    }

    async removerPlanta(id) {
        return this.remover("planta_linha", id);
    }

    async listarPlantasDaLinha(linhaId) {
        const plantas = await this.obterTodos("planta_linha", "index_linha_id", linhaId);
        return plantas.sort((a, b) => a.indice_metro - b.indice_metro);
    }

    // A biblioteca de plantas (especies, fichas, catálogo) vive no store `catalogo` e tem módulo próprio: db/biblioteca.js.

    // ---- elemento_contexto ----

    /**
     * Elementos de contexto (casas, cercas, ruas etc, importados do KML/KMZ
     * para ajudar a situar a propriedade — ver docs/especificacao.md secao
     * 14.8) não têm estado próprio do usuário, então uma reimportação apenas
     * substitui os anteriores em vez de fazer upsert.
     */
    async substituirElementosContexto(projetoId, elementos) {
        const existentes = await this.listarElementosContexto(projetoId);
        await this.removerVarios("elemento_contexto", existentes.map(e => e.id));

        const agora = Date.now();
        for (const elemento of elementos) {
            await this.salvar("elemento_contexto", {
                id: this.gerarId(),
                projeto_id: projetoId,
                nome: elemento.nome,
                tipo: elemento.tipo,
                geometria: elemento.geometria,
                caminho: elemento.caminho,
                origem: "kmz_importado",
                criado_em: agora
            });
        }
    }

    async listarElementosContexto(projetoId) {
        return this.obterTodos("elemento_contexto", "index_projeto_id", projetoId);
    }
}

export const plantaTerraDB = new PlantaTerraDB();
