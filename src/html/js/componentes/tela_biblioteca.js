import { exportarFichas, importarBiblioteca } from "../db/exportador_biblioteca.js";
import { criarEspecieProria, listarFichas, obterRegistro, removerFicha, removerTodasAsFichas, salvarFicha } from "../db/biblioteca.js";
import { buscarCatalogo, cabecalhoDoCatalogo, contarCatalogo, contextoDoTaxon, ehArquivoDeCatalogoNacional, exportarCatalogoNacional, importarCatalogoNacional, limparCatalogo, listarCatalogo }
    from "../db/catalogo_nacional.js";
import { CICLOS_ESPECIE, chaveEspecie, normalizarNome } from "../dominio/biblioteca_plantas.js";
import { especieDoRegistro, fichaDeBruta } from "../dominio/biblioteca_unificada.js";
import { RANGOS } from "../dominio/catalogo_nacional.js";
import { ROTULO_FUNCAO, FILTROS_VAZIOS, ORDENACOES, atende, construirFacetas, contarCriterios, descreverFiltros, exigeFicha, ordenar, semChip } from "../dominio/filtros_especies.js";
import "./card_planta.js";
import "./campo_limpavel.js";
import "./ficha_taxon.js";
import "./painel_filtros_especies.js";

const ROTULO_CICLO = { anual: "Anual", bienal: "Bienal", perene: "Perene" };
const FORMAS_DE_VIDA = ["árvore", "arbusto", "subarbusto", "palmeira", "erva", "trepadeira", "epífita", "suculenta", "aquática"];
const ESTRATOS = ["emergente", "alto", "médio", "baixo"];
const LUZ = ["pleno sol", "meia-sombra", "sombra"];

const TAMANHO_PAGINA = 40;
const CHAVE_FILTROS = "plantaterra.biblioteca.filtros";
const CHAVE_ORDEM = "plantaterra.biblioteca.ordem";
const formatarNumero = n => n.toLocaleString("pt-BR");

/**
 * <tela-biblioteca>: a biblioteca de plantas (docs/especificacao.md §15) — uma só: o catálogo nacional, em que as espécies
 * com ficha completa (Embrapa, curadoria, o que a pessoa preencheu) aparecem primeiro. A ficha de uma espécie é uma tela
 * (rota #/biblioteca/taxon/<id>), com "←" e migalhas no cabeçalho; lista e ficha são a mesma tela, então filtros, busca,
 * páginas carregadas e rolagem da lista voltam como estavam. Não pertence a um projeto — é reaproveitada por todos.
 */
export class TelaBiblioteca extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <div class="tela-biblioteca">
                <header class="cabecalho-app cabecalho-projeto">
                    <button type="button" class="botao-voltar" data-acao="voltar" aria-label="Voltar">←</button>
                    <nav class="migalhas" aria-label="Você está em"></nav>
                </header>

                <div class="painel-biblioteca">
                    <div class="acoes-lista-projetos">
                        <button type="button" class="botao-primario" data-acao="nova-especie">+ Nova espécie</button>
                        <button type="button" class="botao-secundario" data-acao="exportar">Exportar</button>
                        <button type="button" class="botao-secundario" data-acao="abrir-limpar">Limpar</button>
                        <label class="botao-secundario botao-arquivo">
                            Importar
                            <input type="file" accept="application/json,.json,.jsonl,.gz,application/gzip" data-acao="importar" hidden />
                        </label>
                    </div>

                    <campo-limpavel class="busca-biblioteca-caixa">
                        <input type="search" class="busca-biblioteca" placeholder="Buscar por nome popular ou científico…" aria-label="Buscar espécie" />
                    </campo-limpavel>
                    <div class="barra-filtros">
                        <button type="button" class="botao-secundario" data-acao="abrir-filtros">⚙ Filtros <span class="contagem-filtros"></span></button>
                        <label class="ordenacao">Ordenar fichas
                            <select name="ordem">${Object.entries(ORDENACOES).map(([valor, rotulo]) => `<option value="${valor}">${rotulo}</option>`).join("")}</select>
                        </label>
                    </div>
                    <div class="chips-filtros-ativos"></div>
                    <p class="resumo-resultado" aria-live="polite"></p>
                    <p class="progresso-catalogo" hidden><progress></progress> <span></span></p>
                    <ul class="lista-especies"></ul>
                    <button type="button" class="botao-secundario mostrar-mais" data-acao="mostrar-mais" hidden>Mostrar mais</button>
                    <p class="detalhe-fontes fonte-catalogo" hidden></p>
                </div>

                <div class="vista-ficha" hidden>
                    <ficha-taxon></ficha-taxon>
                </div>
                <painel-filtros-especies></painel-filtros-especies>

                <dialog class="dialogo-exportar">
                    <h2>Exportar</h2>
                    <p class="ajuda-campo">Escolha o que vai para o arquivo.</p>
                    <div class="acoes-formulario acoes-exportar">
                        <button type="button" class="botao-primario" data-acao="exportar-fichas">Fichas completas<small>com todas as fotos — para mandar a outra pessoa</small></button>
                        <button type="button" data-acao="exportar-catalogo">Catálogo nacional<small>táxons, sem as fichas</small></button>
                        <button type="button" data-acao="cancelar-exportar">Cancelar</button>
                    </div>
                </dialog>

                <dialog class="dialogo-limpar">
                    <h2>Limpar a biblioteca</h2>
                    <p class="ajuda-campo texto-limpar"></p>
                    <p class="ajuda-campo">Seus <strong>projetos não são tocados</strong>: as plantas já cadastradas continuam, com o nome em texto.</p>
                    <div class="acoes-formulario acoes-exportar">
                        <button type="button" data-acao="limpar-fichas">Limpar só as fichas<small class="detalhe-limpar-fichas"></small></button>
                        <button type="button" class="botao-perigo" data-acao="limpar-tudo">Limpar tudo<small class="detalhe-limpar-tudo"></small></button>
                        <button type="button" data-acao="cancelar-limpar">Cancelar</button>
                    </div>
                </dialog>

                <dialog class="dialogo-especie">
                    <form method="dialog" class="formulario-especie">
                        <h2 class="titulo-dialogo-especie"></h2>
                        <label>Nome popular
                            <input type="text" name="nome_popular" required maxlength="80" />
                        </label>
                        <label>Nome científico
                            <input type="text" name="nome_cientifico" maxlength="120" />
                        </label>
                        <label>Outros nomes populares (opcional, separados por vírgula)
                            <input type="text" name="outros_nomes" maxlength="300" />
                        </label>
                        <label>Forma de vida (opcional)
                            <input type="text" name="forma_de_vida" maxlength="80" list="lista-formas-de-vida" />
                            <datalist id="lista-formas-de-vida">${FORMAS_DE_VIDA.map(f => `<option value="${f}"></option>`).join("")}</datalist>
                        </label>
                        <div class="linha-campos">
                            <label>Altura mínima (m)
                                <input type="number" name="altura_min" min="0.1" step="0.1" inputmode="decimal" />
                            </label>
                            <label>Altura máxima (m)
                                <input type="number" name="altura_max" min="0.1" step="0.1" inputmode="decimal" />
                            </label>
                        </div>
                        <label>Estrato no SAF (opcional)
                            <select name="estrato"><option value="">—</option>${ESTRATOS.map(e => `<option value="${e}">${e.replace(/^./, c => c.toUpperCase())}</option>`).join("")}</select>
                        </label>
                        <label>Exigência de luz (opcional)
                            <select name="luz"><option value="">—</option>${LUZ.map(l => `<option value="${l}">${l.replace(/^./, c => c.toUpperCase())}</option>`).join("")}</select>
                        </label>
                        <label>Funções (opcional, separadas por vírgula)
                            <input type="text" name="funcoes" maxlength="200" list="lista-funcoes" placeholder="melífera, madeira, medicinal…" />
                            <datalist id="lista-funcoes">${Object.values(ROTULO_FUNCAO).map(f => `<option value="${f}"></option>`).join("")}</datalist>
                        </label>
                        <label>Ciclo (opcional)
                            <select name="ciclo"><option value="">—</option>${CICLOS_ESPECIE.map(c => `<option value="${c}">${ROTULO_CICLO[c]}</option>`).join("")}</select>
                        </label>
                        <label>Espaçamento recomendado em metros (opcional)
                            <input type="number" name="espacamento" min="0.1" step="0.1" inputmode="decimal" />
                        </label>
                        <label>Notas (opcional)
                            <textarea name="notas" maxlength="1000"></textarea>
                        </label>
                        <p class="erro-formulario" hidden></p>
                        <div class="acoes-formulario">
                            <button type="submit" value="salvar" class="botao-primario">Salvar</button>
                            <button type="button" data-acao="cancelar-especie">Cancelar</button>
                        </div>
                    </form>
                </dialog>
            </div>
        `;

        this.listaElemento = this.querySelector(".lista-especies");
        this.campoBusca = this.querySelector(".busca-biblioteca");
        this.dialogo = this.querySelector(".dialogo-especie");
        this.dialogoExportar = this.querySelector(".dialogo-exportar");
        this.dialogoLimpar = this.querySelector(".dialogo-limpar");
        this.formulario = this.querySelector(".formulario-especie");
        this.elementoErro = this.querySelector(".erro-formulario");
        this.vistaLista = this.querySelector(".painel-biblioteca");
        this.vistaFicha = this.querySelector(".vista-ficha");
        this.fichaTaxon = this.querySelector("ficha-taxon");
        this.painelFiltros = this.querySelector("painel-filtros-especies");
        this.botaoMais = this.querySelector('[data-acao="mostrar-mais"]');
        this.progressoElemento = this.querySelector(".progresso-catalogo");

        this._filtros = this._lerFiltrosSalvos();
        this._ordem = localStorage.getItem(CHAVE_ORDEM) in ORDENACOES ? localStorage.getItem(CHAVE_ORDEM) : "nome";
        this.querySelector('select[name="ordem"]').value = this._ordem;
        this._fichas = [];
        this._especieEmEdicao = null;
        this._mudancasDeRota = 0;
        this._lista = { geracao: 0, proximo: null, fim: true, busca: null, posicao: 0, termo: "" };

        this.querySelector('[data-acao="voltar"]').addEventListener("click", () => {
            if (this._rota().tipo !== "lista") {
                // Numa ficha: volta ao que estava antes (a lista, ou a ficha anterior); aberta direto pela URL, vai à lista.
                if (this._mudancasDeRota > 1) history.back(); else location.hash = "#/biblioteca";
                return;
            }
            // Abrir a tela direto pela URL não deixa histórico para voltar.
            if (history.length > 1) history.back(); else location.hash = "#/";
        });

        this.querySelector('[data-acao="nova-especie"]').addEventListener("click", () => this._abrirFormulario(null));
        this.querySelector('[data-acao="cancelar-especie"]').addEventListener("click", () => this.dialogo.close());
        this.formulario.addEventListener("submit", evento => this._aoSalvar(evento));

        this.campoBusca.addEventListener("input", () => {
            // Espera a pessoa parar de digitar um instante: a busca no catálogo passa por um índice, mas não precisa rodar a cada letra.
            clearTimeout(this._temporizadorBusca);
            this._temporizadorBusca = setTimeout(() => this._recarregarLista(), 200);
        });
        this.querySelector('[data-acao="abrir-filtros"]').addEventListener("click", () => this.painelFiltros.abrir());
        this.painelFiltros.addEventListener("filtros-mudaram", evento => this._aplicarFiltros(evento.detail.filtros));
        this.querySelector('select[name="ordem"]').addEventListener("change", evento => {
            this._ordem = evento.target.value;
            localStorage.setItem(CHAVE_ORDEM, this._ordem);
            this._recarregarLista();
        });
        // Tocar num chip de filtro ativo o remove.
        this.querySelector(".chips-filtros-ativos").addEventListener("click", evento => {
            const botao = evento.target.closest("[data-chip]");
            if (botao) this._aplicarFiltros(semChip(this._filtros, this._chips[Number(botao.dataset.chip)]), { atualizarPainel: true });
        });
        this.botaoMais.addEventListener("click", () => this._carregarMais());
        // Rolar até o fim da lista traz a próxima página sozinho.
        this._observador = new IntersectionObserver(entradas => {
            if (entradas.some(e => e.isIntersecting) && !this.botaoMais.hidden) this._carregarMais();
        });
        this._observador.observe(this.botaoMais);

        // ---- exportar / importar ----
        this.querySelector('[data-acao="exportar"]').addEventListener("click", () => this.dialogoExportar.showModal());
        this.querySelector('[data-acao="cancelar-exportar"]').addEventListener("click", () => this.dialogoExportar.close());
        this.querySelector('[data-acao="exportar-fichas"]').addEventListener("click", async () => {
            this.dialogoExportar.close();
            if (await exportarFichas() === 0) alert("Ainda não há fichas completas para exportar.");
        });
        this.querySelector('[data-acao="exportar-catalogo"]').addEventListener("click", async () => {
            this.dialogoExportar.close();
            if (await exportarCatalogoNacional() === 0) alert("O catálogo nacional não foi importado — não há nada para exportar.");
        });
        // ---- limpar ----
        this.querySelector('[data-acao="abrir-limpar"]').addEventListener("click", () => this._abrirLimpar());
        this.querySelector('[data-acao="cancelar-limpar"]').addEventListener("click", () => this.dialogoLimpar.close());
        this.querySelector('[data-acao="limpar-fichas"]').addEventListener("click", async () => {
            const n = this._fichas.length;
            if (!confirm(`Remover as ${formatarNumero(n)} ficha(s) completa(s)? Os táxons do catálogo continuam; espécies que você criou serão excluídas. Isso não pode ser desfeito.`)) return;
            this.dialogoLimpar.close();
            const removidas = await this._comProgresso("Removendo as fichas…", () => removerTodasAsFichas());
            await this._carregar();
            alert(`${formatarNumero(removidas)} ficha(s) removida(s).`);
        });
        this.querySelector('[data-acao="limpar-tudo"]').addEventListener("click", async () => {
            if (!confirm(`Apagar a biblioteca inteira — ${formatarNumero(this._fichas.length)} ficha(s) e ${formatarNumero(this._total)} registro(s) do catálogo? Para tê-la de volta será preciso importar os arquivos de novo. Isso não pode ser desfeito.`)) return;
            this.dialogoLimpar.close();
            // Apagar 166 mil registros leva alguns segundos: a tela avisa em vez de parecer travada.
            await this._comProgresso("Apagando a biblioteca…", () => limparCatalogo());
            await this._carregar();
            alert("Biblioteca apagada.");
        });

        this.querySelector('[data-acao="importar"]').addEventListener("change", async evento => {
            const arquivo = evento.target.files[0];
            if (!arquivo) return;
            try {
                await this._importar(arquivo);
            } catch (erro) {
                alert(`Não foi possível importar o arquivo: ${erro.message}`);
            } finally {
                evento.target.value = "";
                this.progressoElemento.hidden = true;
            }
        });

        // ---- lista e ficha ----
        // Tocar no card abre a ficha (uma tela, com o "←" no cabeçalho). A ficha é uma rota: o botão voltar do aparelho funciona.
        this.listaElemento.addEventListener("acao-card", evento => {
            if (evento.detail.acao !== "abrir") return;
            location.hash = `#/biblioteca/taxon/${encodeURIComponent(evento.target.closest(".item-card").dataset.id)}`;
        });
        // Navegação entre registros: cada toque abre a ficha do relacionado (uma entrada no histórico).
        this.fichaTaxon.addEventListener("taxon-solicitado", evento => { location.hash = `#/biblioteca/taxon/${encodeURIComponent(evento.detail.id)}`; });
        this.fichaTaxon.addEventListener("editar-ficha", async evento => this._abrirFormulario(await obterRegistro(evento.detail.id)));
        this.fichaTaxon.addEventListener("remover-ficha", async evento => {
            const registro = await obterRegistro(evento.detail.id);
            const pergunta = registro.propria
                ? `Excluir "${registro.ficha?.nome_popular ?? registro.c}" da biblioteca? Plantas já cadastradas em linhas continuam com o nome.`
                : `Remover a ficha de "${registro.ficha?.nome_popular ?? registro.c}"? O táxon continua no catálogo; só os dados da ficha (fotos, altura, funções…) saem.`;
            if (!confirm(pergunta)) return;
            await removerFicha(registro.id);
            await this._carregar();
            if (registro.propria) { if (this._mudancasDeRota > 1) history.back(); else location.hash = "#/biblioteca"; } else this._aplicarRota({ semContar: true });
        });

        // Primeiro os dados, depois a rota (a ficha pode ter sido aberta direto pela URL).
        this._pronto = this._carregar().then(() => this._aplicarRota());
    }

    disconnectedCallback() {
        this._observador?.disconnect();
        clearTimeout(this._temporizadorBusca);
    }

    // ---- rotas: lista e ficha de um registro da biblioteca ----

    _rota() {
        const m = location.hash.match(/^#\/biblioteca\/(?:taxon|especie)\/(.+)$/);
        return m ? { tipo: "ficha", id: decodeURIComponent(m[1]) } : { tipo: "lista" };
    }

    /** Chamado pelo roteador (main.js) quando só o hash muda: a tela não é recriada. */
    aoMudarRota() {
        this._pronto?.then(() => this._aplicarRota());
    }

    _renderizarMigalhas(atual = null) {
        const nav = this.querySelector(".migalhas");
        nav.replaceChildren();
        const separador = () => Object.assign(document.createElement("span"), { className: "migalha-separador", textContent: "/" });
        const link = (texto, href) => Object.assign(document.createElement("a"), { className: "migalha", href, textContent: texto });
        nav.append(link("PlantaTerra", "#/"), separador());
        if (atual === null) {
            nav.append(Object.assign(document.createElement("h1"), { className: "migalha migalha-atual", textContent: "Biblioteca" }));
        } else {
            nav.append(link("Biblioteca", "#/biblioteca"), separador(),
                Object.assign(document.createElement("h1"), { className: "migalha migalha-atual", textContent: atual }));
        }
        nav.querySelector(".migalha-atual").setAttribute("aria-current", "page");
    }

    async _aplicarRota({ semContar = false } = {}) {
        const rota = this._rota();
        if (!semContar) this._mudancasDeRota++;
        const rolagem = this.querySelector(".tela-biblioteca");

        if (rota.tipo === "lista") {
            this._renderizarMigalhas();
            this.vistaFicha.hidden = true;
            this.vistaLista.hidden = false;
            // A lista voltou a aparecer: devolve a rolagem de onde a pessoa saiu.
            if (this._emFicha) requestAnimationFrame(() => { rolagem.scrollTop = this._rolagemDaLista ?? 0; });
            this._emFicha = false;
            return;
        }

        if (!this._emFicha) this._rolagemDaLista = rolagem.scrollTop;
        this._emFicha = true;
        this.vistaLista.hidden = true;
        this.vistaFicha.hidden = false;

        const contexto = await contextoDoTaxon(rota.id);
        if (this._rota().id !== rota.id) return; // a pessoa já foi para outra ficha enquanto carregava
        if (!contexto) { location.replace("#/biblioteca"); return; }
        this._contextoTaxon = contexto;
        this._renderizarMigalhas(especieDoRegistro(contexto.taxon).nome_popular);
        this.fichaTaxon.mostrar(contexto);
        if (!semContar) rolagem.scrollTop = 0;
    }

    // ---- dados ----

    async _carregar() {
        this._total = await contarCatalogo();
        const registros = await listarFichas();
        // Só a capa de cada ficha fica na memória da lista; a ficha aberta busca o registro inteiro (com todas as fotos).
        this._fichas = registros.map(registro => {
            const leve = { ...registro, ficha: { ...registro.ficha, fotos: registro.ficha.fotos?.slice(0, 1) } };
            return { registro: leve, especie: especieDoRegistro(leve) };
        });
        this.painelFiltros.definir(construirFacetas(this._fichas.map(f => f.especie)));
        this.painelFiltros.filtros = this._filtros;

        const cabecalho = cabecalhoDoCatalogo();
        const fonte = this.querySelector(".fonte-catalogo");
        fonte.hidden = !cabecalho;
        if (cabecalho) fonte.textContent = `Taxonomia: ${cabecalho.citacao ?? cabecalho.fonte}${cabecalho.publicado_em ? ` Versão de ${cabecalho.publicado_em}.` : ""} Licença CC BY 4.0.`;
        await this._recarregarLista();
    }

    _lerFiltrosSalvos() {
        try {
            return { ...FILTROS_VAZIOS, ...JSON.parse(localStorage.getItem(CHAVE_FILTROS) ?? "{}") };
        } catch {
            return { ...FILTROS_VAZIOS };
        }
    }

    /** Novos critérios (do painel ou de um chip): guarda, e refaz a lista. */
    _aplicarFiltros(filtros, { atualizarPainel = false } = {}) {
        this._filtros = { ...FILTROS_VAZIOS, ...filtros };
        localStorage.setItem(CHAVE_FILTROS, JSON.stringify(this._filtros));
        if (atualizarPainel) this.painelFiltros.filtros = this._filtros;
        this._recarregarLista();
    }

    async _importar(arquivo) {
        this.progressoElemento.hidden = false;
        const texto = this.progressoElemento.querySelector("span");
        if (ehArquivoDeCatalogoNacional(arquivo)) {
            texto.textContent = "Importando o catálogo nacional…";
            const { importadas, invalidas, fichasFundidas } = await importarCatalogoNacional(arquivo, n => { texto.textContent = `Importando… ${formatarNumero(n)} táxons`; });
            await this._carregar();
            alert(`Catálogo nacional importado: ${formatarNumero(importadas)} táxon(s)${invalidas ? `, ${invalidas} linha(s) ignorada(s)` : ""}.`
                + (fichasFundidas ? ` ${fichasFundidas} ficha(s) já existente(s) foram ligadas ao táxon correspondente.` : ""));
            return;
        }
        texto.textContent = "Lendo o arquivo…";
        const { adicionadas, atualizadas, complementadas, preservadas, invalidas } = await importarBiblioteca(arquivo, n => { texto.textContent = `Importando fichas… ${formatarNumero(n)}`; });
        await this._carregar();
        const partes = [`${adicionadas} ficha(s) adicionada(s)`];
        if (atualizadas) partes.push(`${atualizadas} atualizada(s)`);
        if (complementadas) partes.push(`${complementadas} já tinha(m) ficha de outro arquivo (só receberam o que faltava)`);
        if (preservadas) partes.push(`${preservadas} editada(s) por você mantida(s) (só receberam o que faltava)`);
        if (invalidas) partes.push(`${invalidas} ignorada(s) por falta de nome`);
        alert(`Importação concluída: ${partes.join(", ")}.`);
    }

    async _comProgresso(texto, operacao) {
        this.progressoElemento.hidden = false;
        this.progressoElemento.querySelector("span").textContent = texto;
        try {
            return await operacao();
        } finally {
            this.progressoElemento.hidden = true;
        }
    }

    _abrirLimpar() {
        const fichas = this._fichas.length;
        const proprias = this._fichas.filter(f => f.registro.propria).length;
        const noCatalogo = this._total - proprias;
        this.querySelector(".texto-limpar").textContent = fichas === 0 && this._total === 0
            ? "A biblioteca já está vazia."
            : `Hoje há ${formatarNumero(fichas)} ficha(s) completa(s) e ${formatarNumero(noCatalogo)} táxon(s) do catálogo nacional.`;
        this.querySelector(".detalhe-limpar-fichas").textContent = fichas
            ? `tira os dados completos de ${formatarNumero(fichas)} espécie(s); o catálogo de nomes fica` : "não há fichas";
        this.querySelector(".detalhe-limpar-tudo").textContent = this._total + fichas
            ? "fichas e catálogo — para voltar, importe os arquivos de novo" : "nada para apagar";
        this.querySelector('[data-acao="limpar-fichas"]').disabled = fichas === 0;
        this.querySelector('[data-acao="limpar-tudo"]').disabled = this._total === 0 && fichas === 0;
        this.dialogoLimpar.showModal();
    }

    // ---- lista: espécies com ficha completa primeiro, depois o catálogo (paginado por cursor) ----

    /** Predicado dos critérios que valem para qualquer registro (o nível é do banco e fica de fora). */
    _predicado() {
        const filtros = this._filtros;
        return contarCriterios({ ...filtros, nivel: null }) ? registro => atende(especieDoRegistro(registro), filtros) : null;
    }

    async _recarregarLista() {
        const lista = this._lista;
        const geracao = ++lista.geracao;
        const termo = this.campoBusca.value.trim();
        const filtros = this._filtros;
        const nivel = filtros.nivel ?? "especie";
        const predicado = this._predicado();
        lista.termo = termo;
        this._itens = [];

        if (this._fichas.length === 0 && this._total === 0) {
            this.listaElemento.innerHTML = `<li class="lista-vazia">A biblioteca está vazia. Use "Importar" para carregar um arquivo de fichas (<code>.json</code>) e o catálogo nacional (<code>.jsonl.gz</code>), ou cadastre uma espécie.</li>`;
            this.botaoMais.hidden = true;
            this._atualizarBarra({ fichas: 0, termo });
            return;
        }

        let fichasMostradas = 0;
        if (termo) {
            const { itens } = await buscarCatalogo(termo, { filtros: { nivel, predicado } });
            if (geracao !== lista.geracao) return; // chegou uma busca mais nova
            Object.assign(lista, { busca: itens, posicao: 0, proximo: null, fim: false });
            this.listaElemento.replaceChildren();
            this._anexarPaginaDaBusca();
            fichasMostradas = itens.filter(r => r.rica).length;
        } else {
            // Fase 1: as espécies com ficha (poucas centenas, já em memória), filtradas e ordenadas.
            const daFase1 = this._fichas.filter(f => (!filtros.nivel || f.registro.nv === filtros.nivel) && atende(f.especie, filtros));
            const ordenadas = ordenar(daFase1.map(f => f.especie), this._ordem);
            const porId = new Map(daFase1.map(f => [f.registro.id, f.registro]));
            const registros = ordenadas.map(e => porId.get(e.id));
            fichasMostradas = registros.length;
            // Fase 2: o resto do catálogo por cursor — só se nenhum critério exige ficha (altura, função, foto…).
            const soFichas = exigeFicha(filtros) || this._total === 0;
            let pagina = { itens: [], proximo: null };
            if (!soFichas) {
                pagina = await listarCatalogo({ filtros: { nivel, excluirRicas: true, predicado }, limite: TAMANHO_PAGINA });
                if (geracao !== lista.geracao) return;
            }
            Object.assign(lista, { busca: null, posicao: 0, proximo: pagina.proximo, fim: soFichas || !pagina.proximo });
            this.listaElemento.replaceChildren();
            if (registros.length) {
                this._anexarSeparador(`⭐ Com ficha completa (${formatarNumero(registros.length)})`);
                this._anexarCards(registros);
            }
            if (pagina.itens.length) {
                if (registros.length) this._anexarSeparador(`Catálogo nacional (${formatarNumero(this._total)} táxons)`);
                this._anexarCards(pagina.itens);
            }
        }
        this._atualizarBarra({ fichas: fichasMostradas, termo });
        this._atualizarRodape();
    }

    async _carregarMais() {
        const lista = this._lista;
        if (lista.fim || this._carregandoMais || this._rota().tipo !== "lista") return;
        this._carregandoMais = true;
        try {
            if (lista.busca) {
                this._anexarPaginaDaBusca();
            } else {
                const geracao = lista.geracao;
                const { itens, proximo } = await listarCatalogo({
                    filtros: { nivel: this._filtros.nivel ?? "especie", excluirRicas: true, predicado: this._predicado() }, depois: lista.proximo, limite: TAMANHO_PAGINA
                });
                if (geracao !== lista.geracao) return;
                lista.proximo = proximo;
                lista.fim = !proximo;
                this._anexarCards(itens);
            }
            this._atualizarRodape();
        } finally {
            this._carregandoMais = false;
        }
    }

    _anexarPaginaDaBusca() {
        const lista = this._lista;
        const pagina = lista.busca.slice(lista.posicao, lista.posicao + TAMANHO_PAGINA);
        lista.posicao += pagina.length;
        lista.fim = lista.posicao >= lista.busca.length;
        this._anexarCards(pagina);
    }

    _atualizarRodape() {
        this.botaoMais.hidden = this._lista.fim;
        if (this._itens.length === 0) {
            const comCriterios = contarCriterios(this._filtros) > 0;
            this.listaElemento.innerHTML = `<li class="lista-vazia">Nenhuma espécie encontrada${comCriterios ? " com esses filtros" : this._lista.termo ? " para essa busca" : ""}.${comCriterios
                ? ` <button type="button" class="botao-link" data-acao="limpar-filtros">Limpar filtros</button>` : ""}</li>`;
            this.listaElemento.querySelector('[data-acao="limpar-filtros"]')?.addEventListener("click", () => this._aplicarFiltros({}, { atualizarPainel: true }));
        } else if (this._lista.busca && this._lista.fim && this._lista.busca.length >= 600) {
            this.listaElemento.insertAdjacentHTML("beforeend", `<li class="lista-vazia">Mostrando só as primeiras ${formatarNumero(this._lista.busca.length)} — refine a busca.</li>`);
        }
    }

    _anexarSeparador(texto) {
        this.listaElemento.append(Object.assign(document.createElement("li"), { className: "separador-lista", textContent: texto }));
    }

    /** Chips dos filtros ativos, contador no botão e o resumo do resultado. */
    _atualizarBarra({ fichas, termo }) {
        this._chips = descreverFiltros(this._filtros);
        const n = contarCriterios(this._filtros);
        this.querySelector(".contagem-filtros").textContent = n ? `(${n})` : "";
        this.querySelector(".chips-filtros-ativos").replaceChildren(...this._chips.map((chip, i) => {
            const botao = document.createElement("button");
            botao.type = "button";
            botao.className = "chip-ativo";
            botao.dataset.chip = String(i);
            botao.textContent = `${chip.texto} ✕`;
            botao.setAttribute("aria-label", `Remover filtro ${chip.texto}`);
            return botao;
        }));
        const resumo = this.querySelector(".resumo-resultado");
        const totalFichas = this._fichas.length;
        if (n || termo) {
            resumo.textContent = `${formatarNumero(fichas)} com ficha completa` + (exigeFicha(this._filtros) || this._total === 0 ? "" : " · mais resultados do catálogo abaixo");
        } else {
            resumo.textContent = `${formatarNumero(totalFichas)} com ficha completa · ${formatarNumero(this._total)} táxons no catálogo`;
        }
        this.painelFiltros.contagem = exigeFicha(this._filtros) || this._total === 0 ? fichas : null;
    }

    _anexarCards(registros) {
        const termo = normalizarNome(this.campoBusca.value);
        const destaque = this.campoBusca.value;
        this._itens.push(...registros);
        this.listaElemento.append(...registros.map(registro => {
            const e = especieDoRegistro(registro);
            const item = document.createElement("li");
            item.className = "item-card";
            item.dataset.id = registro.id;
            const card = document.createElement("card-planta");
            const alias = termo ? (registro.p ?? []).slice(1).find(n => normalizarNome(n).includes(termo)) : null;
            const nivel = RANGOS[registro.k] ?? registro.k;
            const altura = e.altura_min_m && e.altura_max_m && e.altura_min_m !== e.altura_max_m ? `${e.altura_min_m} a ${e.altura_max_m} m`
                : (e.altura_max_m ?? e.altura_min_m) ? `${e.altura_max_m ?? e.altura_min_m} m` : null;
            card.dados = {
                nome: e.nome_popular,
                cientifico: registro.sem_cientifico || e.nome_popular === registro.c ? "" : registro.c,
                foto: e.fotos[0]?.src ?? null,
                linhas: [
                    alias ? `também: ${alias}` : registro._via ? `sinônimo: ${registro._via}` : "",
                    [registro.k !== "sp" ? nivel : null, registro.nv === "sinonimo" ? "sinônimo" : null, e.familia, registro.fi && !e.rica ? registro.fi : null].filter(Boolean).join(" · "),
                    e.rica ? ["⭐ ficha completa", e.forma_de_vida, altura].filter(Boolean).join(" · ")
                        : [registro.o, registro.v?.join(", ")].filter(Boolean).join(" · ")
                ],
                clicavel: true,
                destaque
            };
            item.appendChild(card);
            return item;
        }));
    }

    // ---- formulário: criar uma espécie própria, ou criar/editar a ficha de um registro ----

    /** `registro` = null: nova espécie. Senão: edita a ficha dele (ou a cria, se o táxon ainda não tinha). */
    _abrirFormulario(registro) {
        this._registroEmEdicao = registro;
        this.formulario.reset();
        this.elementoErro.hidden = true;
        const e = registro ? especieDoRegistro(registro) : null;
        this.querySelector(".titulo-dialogo-especie").textContent = !registro ? "Nova espécie" : registro.ficha ? "Editar ficha" : "Criar ficha";
        const campos = this.formulario.elements;
        // O nome científico de um táxon do catálogo é o do catálogo: não se edita aqui.
        campos.nome_cientifico.readOnly = !!registro && !registro.propria;
        if (e) {
            campos.nome_popular.value = e.nome_popular;
            campos.nome_cientifico.value = e.nome_cientifico ?? "";
            campos.outros_nomes.value = e.nomes_populares.slice(1).join(", ");
            campos.forma_de_vida.value = e.forma_de_vida ?? "";
            campos.altura_min.value = e.altura_min_m ?? "";
            campos.altura_max.value = e.altura_max_m ?? "";
            campos.estrato.value = ESTRATOS.find(x => normalizarNome(x) === normalizarNome(e.estrato_saf ?? "")) ?? "";
            campos.luz.value = LUZ.includes(e.exigencia_luminosa) ? e.exigencia_luminosa : "";
            campos.funcoes.value = (e.funcoes ?? []).map(f => ROTULO_FUNCAO[f] ?? f.replaceAll("_", " ")).join(", ");
            campos.ciclo.value = e.ciclo ?? "";
            campos.espacamento.value = e.espacamento_recomendado_m ?? "";
            campos.notas.value = registro.ficha?.notas ?? "";
        }
        this.dialogo.showModal();
    }

    async _aoSalvar(evento) {
        if (evento.submitter?.value !== "salvar") return;
        // method="dialog" fecharia o diálogo antes da validação.
        evento.preventDefault();

        const d = new FormData(this.formulario);
        const lista = nome => d.get(nome).split(",").map(t => t.trim()).filter(Boolean);
        const numero = nome => (d.get(nome) ? Number(d.get(nome)) : null);
        const registro = this._registroEmEdicao;
        const nomePopular = d.get("nome_popular").trim();
        const rotuloParaChave = Object.fromEntries(Object.entries(ROTULO_FUNCAO).map(([chave, rotulo]) => [normalizarNome(rotulo), chave]));
        const funcoes = lista("funcoes").map(f => rotuloParaChave[normalizarNome(f)] ?? normalizarNome(f).replace(/\W+/g, "_"));
        const cientifico = registro && !registro.propria ? registro.c : (d.get("nome_cientifico").trim() || null);

        const ficha = fichaDeBruta({
            ...(registro?.ficha ?? {}),
            nome_popular: nomePopular,
            nome_cientifico: cientifico,
            nomes_populares: [nomePopular, ...lista("outros_nomes")],
            forma_de_vida: d.get("forma_de_vida").trim() || null,
            altura_min_m: numero("altura_min"),
            altura_max_m: numero("altura_max"),
            estrato_saf: d.get("estrato") || null,
            exigencia_luminosa: d.get("luz") || null,
            funcoes,
            ciclo: d.get("ciclo") || null,
            espacamento_recomendado_m: numero("espacamento"),
            notas: d.get("notas").trim() || null
        });
        if (!ficha) { this._mostrarErro("Informe o nome popular."); return; }

        let idFinal;
        if (registro) {
            await salvarFicha(registro.id, ficha);
            idFinal = registro.id;
        } else {
            // Já existe um táxon com esse nome científico? Então a ficha vai para ele (não se duplica a espécie).
            let existente = null;
            if (cientifico) {
                const { itens } = await buscarCatalogo(cientifico, { filtros: { nivel: "especie" } });
                existente = itens.find(t => t.cn === normalizarNome(cientifico));
            }
            if (existente) {
                await salvarFicha(existente.id, ficha);
                idFinal = existente.id;
            } else {
                idFinal = (await criarEspecieProria(ficha)).id;
            }
        }
        this.dialogo.close();
        await this._carregar();
        // Criou uma espécie nova: abre a ficha dela. Editou: a ficha aberta mostra os dados novos.
        if (!registro) location.hash = `#/biblioteca/taxon/${encodeURIComponent(idFinal)}`;
        else if (this._rota().tipo === "ficha") this._aplicarRota({ semContar: true });
    }

    _mostrarErro(texto) {
        this.elementoErro.textContent = texto;
        this.elementoErro.hidden = false;
    }
}

customElements.define("tela-biblioteca", TelaBiblioteca);
