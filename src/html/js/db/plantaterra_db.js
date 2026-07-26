import { DBBase } from "./db_base.js";

const NOME_BANCO = "PlantaTerraDB";
const VERSAO = 1;

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
    }
];

class PlantaTerraDB extends DBBase {
    constructor() {
        super(NOME_BANCO, VERSAO, funcoesDeMigracao);
    }

    gerarId() {
        return crypto.randomUUID();
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
        const [trilhas, estacoes] = await Promise.all([
            this.listarTrilhas(id),
            this.listarEstacoes(id)
        ]);

        const leiturasPorEstacao = await Promise.all(
            estacoes.map(estacao => this.listarLeituras(estacao.id))
        );

        await Promise.all([
            this.removerVarios("trilha_perimetro", trilhas.map(t => t.id)),
            this.removerVarios("estacao_nivel", estacoes.map(e => e.id)),
            this.removerVarios("leitura_nivel", leiturasPorEstacao.flat().map(l => l.id))
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

    async trilhaAtiva(projetoId) {
        const trilhas = await this.listarTrilhas(projetoId);
        return trilhas.find(t => t.ativo) || null;
    }

    // ---- estacao_nivel ----

    async criarEstacao({ projetoId, nome, coordenada, alturaInstrumento, amarradaAEstacaoId = null }) {
        const estacao = {
            id: this.gerarId(),
            projeto_id: projetoId,
            nome,
            coordenada,
            altura_instrumento: alturaInstrumento,
            offset_altitude: 0,
            amarrada_a_estacao_id: amarradaAEstacaoId,
            criado_em: Date.now()
        };
        await this.salvar("estacao_nivel", estacao);
        return estacao;
    }

    async atualizarEstacao(estacao) {
        return this.salvar("estacao_nivel", estacao);
    }

    async listarEstacoes(projetoId) {
        const estacoes = await this.obterTodos("estacao_nivel", "index_projeto_id", projetoId);
        return estacoes.sort((a, b) => a.criado_em - b.criado_em);
    }

    async obterEstacao(id) {
        return this.obterPorChave("estacao_nivel", id);
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

    async atualizarLeitura(leitura) {
        return this.salvar("leitura_nivel", leitura);
    }

    async listarLeituras(estacaoId) {
        const leituras = await this.obterTodos("leitura_nivel", "index_estacao_id", estacaoId);
        return leituras.sort((a, b) => a.criado_em - b.criado_em);
    }

    async removerLeitura(id) {
        return this.remover("leitura_nivel", id);
    }

    async listarTodasLeiturasDoProjeto(projetoId) {
        const estacoes = await this.listarEstacoes(projetoId);
        const listas = await Promise.all(estacoes.map(e => this.listarLeituras(e.id)));
        return estacoes.map((estacao, indice) => ({ estacao, leituras: listas[indice] }));
    }
}

export const plantaTerraDB = new PlantaTerraDB();
