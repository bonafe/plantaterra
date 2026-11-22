import { plantaTerraDB } from "../db/plantaterra_db.js";
import { exportarProjeto, importarArquivo } from "../db/exportador_projeto.js";
import { exportarGeoJSON, exportarKML, exportarKMZ, exportarKMLTrilha } from "../db/exportador_geoespacial.js";
import { CaptadorTrilha } from "../gps/captador_trilha.js";
import {
    calcularAltitudeLeitura,
    calcularOffsetPorAmarracao,
    recalcularLeiturasDaEstacao,
    consolidarPontosDoProjeto
} from "../dominio/nivelamento.js";
import { gerarCurvasDeNivel } from "../geo/curvas_de_nivel.js";
import { simplificarTrilha, avaliarFechamento } from "../geo/douglas_peucker.js";
import { calcularCascoConvexo } from "../geo/casco_convexo.js";
import { areaPoligonoMetros2 } from "../geo/geodesia.js";
import { dividirEmMetros } from "../geo/segmentador_linha.js";
import { calcularMatrizSaf } from "../geo/matriz_saf.js";
import { agruparPlantasPorMetro } from "../dominio/saf.js";
import { analisarArquivoParaImportacao, importarParaProjeto } from "../kml/importador_saf.js";
import { escaparHtml, formatarArea, formatarData } from "./util_dom.js";
import "./mapa_projeto.js";
import "./captura_gps.js";
import "./matriz_saf.js";
import "./andar_gps.js";
import "./dialogo_planta_metro.js";
import "./editor_pontos_trilha.js";
import "./dialogo_estacao.js";
import "./dialogo_leitura.js";
import "./lista_estacoes.js";
import "./dialogo_historico_perimetro.js";
import "./dialogo_importar_saf.js";

const CHAVE_ULTIMO_LUGAR = "plantaterra:ultimo-lugar";

/**
 * <painel-projeto data-id="...">: tela principal de um projeto — mapa +
 * fluxos de mapeamento de perímetro e de registro de nível.
 */
export class PainelProjeto extends HTMLElement {

    async connectedCallback() {
        this.projetoId = this.dataset.id;
        this.projeto = await plantaTerraDB.obterProjeto(this.projetoId);

        if (!this.projeto) {
            this.innerHTML = `<p>Projeto não encontrado. <a href="#/">Voltar</a></p>`;
            return;
        }

        this.innerHTML = `
            <div class="tela-painel-projeto">
                <header class="cabecalho-app cabecalho-projeto">
                    <a href="#/" class="botao-voltar" aria-label="Voltar">←</a>
                    <nav class="migalhas" aria-label="Você está em"></nav>
                    <button type="button" data-acao="abrir-menu" class="botao-icone" aria-label="Menu do projeto" aria-haspopup="true" aria-expanded="false">⋮</button>
                    <nav class="menu-projeto" hidden>
                        <p class="menu-projeto-titulo">Exportar</p>
                        <button type="button" data-acao="exportar-backup">
                            <strong>Backup do projeto</strong><span>.json — para restaurar depois</span>
                        </button>
                        <button type="button" data-acao="exportar-geojson">
                            <strong>GeoJSON</strong><span>.geojson — QGIS, Mapbox etc.</span>
                        </button>
                        <button type="button" data-acao="exportar-kml">
                            <strong>KML</strong><span>.kml — Google Earth</span>
                        </button>
                        <button type="button" data-acao="exportar-kmz">
                            <strong>KMZ completo</strong><span>.kmz — Google Earth</span>
                        </button>
                        <p class="menu-projeto-titulo">Importar</p>
                        <button type="button" data-acao="importar-backup">
                            <strong>Backup</strong><span>.json — cria um projeto novo (não sobrescreve)</span>
                        </button>
                        <button type="button" data-acao="importar-kmz">
                            <strong>KMZ/KML</strong><span>SAF, linhas de plantio e contexto, neste projeto</span>
                        </button>
                        <input type="file" accept="application/json,.json" data-acao="importar-backup-arquivo" hidden />
                    </nav>
                </header>

                <div class="mapa-caixa">
                    <mapa-projeto class="mapa"></mapa-projeto>
                    <button type="button" class="mapa-ampliar" data-acao="mapa-ampliar" aria-label="Ampliar mapa" hidden>⤢</button>
                </div>

                <div class="painel-inferior">
                    <div class="vista-entrada">
                        <button type="button" class="cartao-entrada" data-vista="perimetro">
                            <strong>Perímetro</strong>
                            <span class="resumo-perimetro"></span>
                        </button>
                        <button type="button" class="cartao-entrada" data-vista="estacoes">
                            <strong>Estações de nível</strong>
                            <span class="resumo-estacoes"></span>
                        </button>
                        <button type="button" class="cartao-entrada" data-vista="saf">
                            <strong>Sistemas Agroflorestais (SAF)</strong>
                            <span class="resumo-saf"></span>
                        </button>
                    </div>

                    <div class="secoes-padrao" hidden>
                        <section class="secao-perimetro" data-vista-secao="perimetro">
                            <div class="secao-cabecalho">
                                <h2>Perímetro</h2>
                                <span class="area-perimetro"></span>
                            </div>
                            <label class="campo-checkbox">
                                <input type="checkbox" name="terreno_convexo" />
                                Meu terreno é convexo (sem reentrâncias)
                            </label>
                            <p class="ajuda-campo">
                                Marque se o terreno não tem "cantos para dentro" (ex: um retângulo). O perímetro passa a
                                ser fechado pelos pontos mais externos que você caminhou, mesmo que tenha desviado de
                                plantas ou obstáculos em alguns trechos da divisa.
                            </p>
                            <button type="button" data-acao="mapear-perimetro" class="botao-secundario botao-largo">
                                Mapear perímetro caminhando
                            </button>
                            <button type="button" data-acao="abrir-historico-perimetro" class="botao-secundario botao-largo">
                                Histórico de rodadas
                            </button>
                        </section>

                        <section class="secao-estacoes" data-vista-secao="estacoes">
                            <div class="secao-cabecalho">
                                <h2>Estações de nível</h2>
                                <button type="button" data-acao="nova-estacao" class="botao-primario">+ Estação</button>
                            </div>
                            <lista-estacoes></lista-estacoes>
                        </section>

                        <section class="secao-curvas" data-vista-secao="estacoes">
                            <button type="button" data-acao="gerar-curvas" class="botao-secundario botao-largo">
                                Gerar curvas de nível
                            </button>
                        </section>
                    </div>

                    <section class="vista-saf" hidden>
                        <input type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" data-acao="importar-arquivo-saf" hidden />
                        <div class="saf-modos" role="tablist">
                            <button type="button" class="saf-modo saf-modo-ativo" data-modo="atual">Atual</button>
                            <button type="button" class="saf-modo" data-modo="andar">📍 Andar</button>
                        </div>
                        <div class="saf-seletor"></div>

                        <andar-gps></andar-gps>

                        <p class="editor-saf-info"></p>
                        <matriz-saf></matriz-saf>
                    </section>
                </div>

                <editor-pontos-trilha></editor-pontos-trilha>

                <captura-gps></captura-gps>
                <dialog class="dialogo-caminhada">
                    <h2>Mapeando perímetro</h2>
                    <p class="caminhada-status">Pontos capturados: 0</p>
                    <div class="acoes-formulario">
                        <button type="button" data-acao="pausar-caminhada">Pausar</button>
                        <button type="button" data-acao="desfazer-ponto-caminhada">Desfazer último ponto</button>
                        <button type="button" data-acao="concluir-caminhada" class="botao-primario">Concluir</button>
                        <button type="button" data-acao="cancelar-caminhada">Cancelar</button>
                    </div>
                </dialog>

                <dialogo-historico-perimetro></dialogo-historico-perimetro>

                <dialogo-estacao></dialogo-estacao>
                <dialogo-leitura></dialogo-leitura>

                <dialogo-importar-saf></dialogo-importar-saf>

                <dialogo-planta-metro></dialogo-planta-metro>
            </div>
        `;

        this.mapaElemento = this.querySelector("mapa-projeto");
        this.capturaGps = this.querySelector("captura-gps");

        this._wireMenu();
        this._wireTerrenoConvexo();
        this._wirePerimetro();
        this._wireEditorPontosTrilha();
        this._wireEstacoes();
        this._wireCurvasDeNivel();
        this._wireSaf();
        this._wireVistaSaf();
        this._wireNavegacao();
        this._renderizarMigalhas();

        // A propriedade inteira já na abertura: usa o retângulo gravado, sem esperar as camadas carregarem.
        if (this.projeto.extensao_propriedade) this.mapaElemento.enquadrarExtensao(this.projeto.extensao_propriedade);

        await this.recarregarTudo();

        // Reabre no lugar onde a pessoa estava (ex: dentro da agrofloresta).
        const lugar = this._lugarLembrado();
        if (lugar && ["perimetro", "estacoes", "saf"].includes(lugar.vista)) {
            await this._irParaVista(lugar.vista);
        }
    }

    async recarregarTudo() {
        const [trilhaAtiva, trilhas, estacoesComLeituras, safsComLinhas, elementosContexto] = await Promise.all([
            plantaTerraDB.trilhaAtiva(this.projetoId),
            plantaTerraDB.listarTrilhas(this.projetoId),
            plantaTerraDB.listarTodasLeiturasDoProjeto(this.projetoId),
            plantaTerraDB.listarTodasLinhasDoProjeto(this.projetoId),
            plantaTerraDB.listarElementosContexto(this.projetoId)
        ]);

        this.trilhaAtiva = trilhaAtiva;
        this.estacoesComLeituras = estacoesComLeituras;
        this.safsComLinhas = safsComLinhas;

        // Vários perímetros podem estar marcados como visíveis ao mesmo tempo
        // (ex: a propriedade toda + uma área interna) — o campo "ativo" segue
        // existindo só para o resumo de área do topo e a exportação completa.
        const trilhasVisiveis = trilhas.filter(t => t.visivel !== false);

        this.mapaElemento.definirElementosContexto(elementosContexto);
        this.mapaElemento.definirPerimetros(trilhasVisiveis);
        this.mapaElemento.definirEstacoesELeituras(estacoesComLeituras);
        this.mapaElemento.definirLinhasSaf(safsComLinhas);
        // Na vista SAF o mapa acompanha a fileira/a pessoa: não reenquadra tudo a cada recarga.
        if (this._vista !== "saf") this.mapaElemento.ajustarZoomParaConteudo();
        await this._atualizarExtensaoPropriedade();

        const areaElemento = this.querySelector(".area-perimetro");
        areaElemento.textContent = trilhaAtiva?.poligono?.length >= 3
            ? formatarArea(areaPoligonoMetros2(trilhaAtiva.poligono))
            : "ainda não mapeado";

        this._renderizarListaEstacoes();
        this._atualizarResumos();
        if (this._vista === "saf") await this._recarregarVistaSaf();
    }

    /**
     * Mantém em projeto.extensao_propriedade o retângulo que cobre os pontos mais distantes
     * (perímetro, estações, SAF, contexto): é o que enquadra a propriedade inteira ao abrir o projeto.
     * Só grava quando muda (docs/especificacao.md §8).
     */
    async _atualizarExtensaoPropriedade() {
        const nova = this.mapaElemento.extensaoDoConteudo();
        if (!nova) return;
        const antiga = this.projeto.extensao_propriedade;
        const igual = antiga && ["sul", "oeste", "norte", "leste"].every(k => Math.abs(antiga[k] - nova[k]) < 1e-7);
        if (igual) return;
        this.projeto = await plantaTerraDB.salvar("projeto", { ...this.projeto, extensao_propriedade: nova });
    }

    // ---------------- Migalhas (breadcrumbs) ----------------

    static NOMES_VISTA = { perimetro: "Perímetro", estacoes: "Estações de nível", saf: "Agrofloresta" };

    /**
     * Cabeçalho "← Projeto / Agrofloresta / SAF / Linha X · metro N": mostra onde a pessoa está e
     * cada trecho (menos o último) leva de volta àquele nível.
     */
    _renderizarMigalhas() {
        const nav = this.querySelector(".migalhas");
        if (!nav) return;
        const trechos = [{ texto: this.projeto.nome, nivel: "projeto" }];
        if (this._vista !== "entrada") {
            trechos.push({ texto: PainelProjeto.NOMES_VISTA[this._vista], nivel: "vista" });
            if (this._vista === "saf") {
                const safAtual = this._dadosSaf?.find(d => d.saf.id === this._safAtualId)?.saf;
                if (safAtual) trechos.push({ texto: safAtual.nome, nivel: "saf" });
                if (this._rotuloMetroAberto && this.querySelector("dialogo-planta-metro")?.aberto) {
                    trechos.push({ texto: this._rotuloMetroAberto, nivel: "metro" });
                }
            }
        }
        nav.innerHTML = trechos.map((t, i) => i === trechos.length - 1
            ? `<span class="migalha migalha-atual" aria-current="page">${escaparHtml(t.texto)}</span>`
            : `<button type="button" class="migalha" data-nivel="${t.nivel}">${escaparHtml(t.texto)}</button><span class="migalha-separador" aria-hidden="true">/</span>`
        ).join("");
    }

    // ---------------- Exportar ----------------

    /**
     * Menu "⋮" do cabeçalho: exportar (backup e formatos GIS) e importar (backup
     * .json, que cria um projeto novo, e KMZ/KML, que entra neste projeto).
     */
    _wireMenu() {
        const botao = this.querySelector('[data-acao="abrir-menu"]');
        const menu = this.querySelector(".menu-projeto");
        const arquivoBackup = menu.querySelector('[data-acao="importar-backup-arquivo"]');

        const fechar = () => {
            menu.hidden = true;
            botao.setAttribute("aria-expanded", "false");
            document.removeEventListener("pointerdown", foraDoMenu, true);
            document.removeEventListener("keydown", aoTeclar, true);
        };
        const foraDoMenu = evento => {
            if (!menu.contains(evento.target) && !botao.contains(evento.target)) fechar();
        };
        const aoTeclar = evento => {
            if (evento.key === "Escape") fechar();
        };
        const abrir = () => {
            menu.hidden = false;
            botao.setAttribute("aria-expanded", "true");
            document.addEventListener("pointerdown", foraDoMenu, true);
            document.addEventListener("keydown", aoTeclar, true);
        };
        this._fecharMenu = fechar;

        botao.addEventListener("click", () => (menu.hidden ? abrir() : fechar()));

        const acoes = {
            "exportar-backup": () => exportarProjeto(this.projetoId),
            "exportar-geojson": () => exportarGeoJSON(this.projetoId),
            "exportar-kml": () => exportarKML(this.projetoId),
            "exportar-kmz": () => exportarKMZ(this.projetoId),
            "importar-backup": () => arquivoBackup.click(),
            // Mesmo fluxo do botão "Importar KMZ/KML" da vista SAF (pré-visualização antes de gravar).
            "importar-kmz": () => this.querySelector('[data-acao="importar-arquivo-saf"]').click()
        };
        menu.addEventListener("click", evento => {
            const item = evento.target.closest("button[data-acao]");
            if (!item || !acoes[item.dataset.acao]) return;
            fechar();
            acoes[item.dataset.acao]();
        });

        arquivoBackup.addEventListener("change", async evento => {
            const arquivo = evento.target.files[0];
            evento.target.value = "";
            if (!arquivo) return;
            try {
                const { projetos, biblioteca } = await importarArquivo(arquivo);
                const partes = [];
                if (projetos.length) partes.push(`${projetos.length} projeto(s) novo(s)`);
                if (biblioteca) {
                    partes.push(`biblioteca: ${biblioteca.adicionadas} espécie(s) adicionada(s)` +
                        (biblioteca.jaExistentes ? `, ${biblioteca.jaExistentes} já existia(m)` : ""));
                }
                const resumo = `Importação concluída: ${partes.join(" · ")}.`;
                // Um projeto só (sem biblioteca): oferece abrir; o atual não foi tocado.
                if (projetos.length === 1 && !biblioteca) {
                    if (confirm(`${resumo}\n\nAbrir o projeto importado agora?`)) location.hash = `#/projeto/${projetos[0].id}`;
                } else {
                    alert(`${resumo} Veja na lista de projetos.`);
                }
            } catch (erro) {
                alert(`Não foi possível importar o arquivo: ${erro.message}`);
            }
        });
    }

    // ---------------- Terreno convexo ----------------

    /**
     * Convexidade é uma característica do terreno, não de uma rodada de
     * captura específica — por isso é uma configuração do projeto (não do
     * editor de pontos), e alterá-la recalcula na hora o polígono de todas
     * as rodadas já salvas (ver docs/especificacao.md secao 6).
     */
    _wireTerrenoConvexo() {
        const checkbox = this.querySelector('[name="terreno_convexo"]');
        checkbox.checked = !!this.projeto.terreno_convexo;

        checkbox.addEventListener("change", async () => {
            const convexo = checkbox.checked;
            this.projeto = await plantaTerraDB.salvar("projeto", {
                ...this.projeto,
                terreno_convexo: convexo,
                atualizado_em: Date.now()
            });

            const trilhas = await plantaTerraDB.listarTrilhas(this.projetoId);
            await Promise.all(trilhas.map(trilha => {
                const poligono = convexo
                    ? calcularCascoConvexo(trilha.pontos_brutos)
                    : simplificarTrilha(trilha.pontos_brutos);
                if (poligono.length < 3) return null;
                return plantaTerraDB.salvarTrilha({ ...trilha, poligono });
            }));

            await this.recarregarTudo();
        });
    }

    // ---------------- Perímetro ----------------

    _wirePerimetro() {
        const dialogo = this.querySelector(".dialogo-caminhada");
        const status = this.querySelector(".caminhada-status");

        this.querySelector('[data-acao="mapear-perimetro"]').addEventListener("click", () => {
            this.captadorTrilha = new CaptadorTrilha();
            this.mapaElemento.iniciarTrilhaEmProgresso();

            this.captadorTrilha.addEventListener(CaptadorTrilha.EVENTO_PONTO_ADICIONADO, evento => {
                status.textContent = `Pontos capturados: ${evento.detail.totalPontos}`;
                this.mapaElemento.atualizarTrilhaEmProgresso(this.captadorTrilha.pontosBrutos);
            });

            this.captadorTrilha.addEventListener(CaptadorTrilha.EVENTO_POSICAO_ATUAL, evento => {
                this.mapaElemento.atualizarPosicaoAtual(evento.detail.lat, evento.detail.lon);
            });

            this.captadorTrilha.iniciar();
            status.textContent = "Pontos capturados: 0";
            dialogo.showModal();
        });

        this.querySelector('[data-acao="pausar-caminhada"]').addEventListener("click", evento => {
            if (this.captadorTrilha.pausado) {
                this.captadorTrilha.retomar();
                evento.target.textContent = "Pausar";
            } else {
                this.captadorTrilha.pausar();
                evento.target.textContent = "Retomar";
            }
        });

        this.querySelector('[data-acao="desfazer-ponto-caminhada"]').addEventListener("click", () => {
            this.captadorTrilha.removerUltimoPonto();
            status.textContent = `Pontos capturados: ${this.captadorTrilha.pontosBrutos.length}`;
            this.mapaElemento.atualizarTrilhaEmProgresso(this.captadorTrilha.pontosBrutos);
        });

        this.querySelector('[data-acao="cancelar-caminhada"]').addEventListener("click", () => {
            this.captadorTrilha.parar();
            this.mapaElemento.pararTrilhaEmProgresso();
            dialogo.close();
        });

        this.querySelector('[data-acao="concluir-caminhada"]').addEventListener("click", async () => {
            const resultado = this.captadorTrilha.concluir();
            this.mapaElemento.pararTrilhaEmProgresso();
            dialogo.close();

            const poligono = this.projeto.terreno_convexo
                ? calcularCascoConvexo(resultado.pontos_brutos)
                : resultado.poligono;

            if (poligono.length < 3) {
                alert("Poucos pontos capturados para formar um perímetro. Tente novamente.");
                return;
            }

            if (!this.projeto.terreno_convexo && !resultado.fechamentoOk) {
                const continuar = confirm(
                    `O ponto final ficou a ${resultado.distanciaFechamento.toFixed(0)} m do ponto inicial — ` +
                    "pode não ter fechado a volta completa da propriedade. Salvar mesmo assim?"
                );
                if (!continuar) return;
            }

            if (this.trilhaAtiva) {
                await plantaTerraDB.salvarTrilha({ ...this.trilhaAtiva, ativo: false });
            }

            await plantaTerraDB.salvarTrilha({
                projeto_id: this.projetoId,
                nome: `Perímetro ${formatarData(Date.now())}`,
                pontos_brutos: resultado.pontos_brutos,
                poligono,
                ativo: true,
                visivel: true,
                criado_em: Date.now()
            });

            await this.recarregarTudo();
        });

        this._wireHistoricoPerimetro();
    }

    /**
     * Histórico de rodadas do perímetro: o <dialogo-historico-perimetro> mostra e
     * avisa; aqui ficam o banco, o editor de pontos, a exportação e a recarga.
     */
    _wireHistoricoPerimetro() {
        const dialogo = this.querySelector("dialogo-historico-perimetro");

        // Cada ação grava, atualiza a lista do diálogo e redesenha o projeto.
        const aplicar = async acaoNoBanco => {
            await acaoNoBanco();
            await this._renderizarHistoricoPerimetro();
            await this.recarregarTudo();
        };

        this.querySelector('[data-acao="abrir-historico-perimetro"]').addEventListener("click", async () => {
            await this._renderizarHistoricoPerimetro();
            dialogo.abrir();
        });

        dialogo.addEventListener("definir-principal", evento =>
            aplicar(() => plantaTerraDB.definirTrilhaAtiva(this.projetoId, evento.detail.id)));

        dialogo.addEventListener("excluir-rodada", evento =>
            aplicar(() => plantaTerraDB.removerTrilha(evento.detail.id)));

        dialogo.addEventListener("renomear-rodada", evento => aplicar(async () => {
            const trilha = await plantaTerraDB.obterTrilha(evento.detail.id);
            await plantaTerraDB.salvarTrilha({ ...trilha, nome: evento.detail.nome });
        }));

        dialogo.addEventListener("visibilidade-alterada", evento => aplicar(async () => {
            const trilha = await plantaTerraDB.obterTrilha(evento.detail.id);
            await plantaTerraDB.salvarTrilha({ ...trilha, visivel: evento.detail.visivel });
        }));

        dialogo.addEventListener("editar-pontos", async evento => {
            const trilha = await plantaTerraDB.obterTrilha(evento.detail.id);
            dialogo.fechar();
            this._abrirEditorPontosTrilha(trilha);
        });

        dialogo.addEventListener("exportar-kml", async evento => {
            const trilha = await plantaTerraDB.obterTrilha(evento.detail.id);
            exportarKMLTrilha(trilha, this.projeto.nome);
        });
    }

    async _renderizarHistoricoPerimetro() {
        this.querySelector("dialogo-historico-perimetro").rodadas = await plantaTerraDB.listarTrilhas(this.projetoId);
    }

    /**
     * Editor de pontos brutos de uma rodada de captura já salva: mostra cada
     * ponto no mapa em gradiente (azul = mais antigo, vermelho = mais
     * recente), permite selecionar um ponto clicando nele e excluí-lo, e só
     * grava no banco (recalculando o polígono) quando o usuário confirma.
     * O estado da edição vive no <editor-pontos-trilha>; aqui ficam o mapa,
     * a validação do polígono e o banco.
     */
    _wireEditorPontosTrilha() {
        const editor = this.querySelector("editor-pontos-trilha");
        this._editorPontos = editor;

        this.mapaElemento.addEventListener("ponto-trilha-clicado", evento => {
            editor.selecionarPonto(evento.detail.indice);
        });

        editor.addEventListener("pontos-mudaram", evento => {
            const { pontos, indiceSelecionado, tMin, tMax, primeira } = evento.detail;
            this.mapaElemento.exibirPontosTrilhaEditavel(pontos, { indiceSelecionado, tMin, tMax, ajustarZoom: primeira });
            if (this.projeto.terreno_convexo) {
                this.mapaElemento.definirPreviaPoligono(calcularCascoConvexo(pontos));
            } else {
                this.mapaElemento.limparPreviaPoligono();
            }
        });

        editor.addEventListener("fechado", () => {
            this.mapaElemento.limparPreviaPoligono();
            this.mapaElemento.limparPontosTrilhaEditavel();
            this.querySelector(".painel-inferior").hidden = false;
            this.mapaElemento.invalidarTamanho();
            this.mapaElemento.ajustarZoomParaConteudo();
        });

        editor.addEventListener("salvar-solicitado", async evento => {
            const { pontos } = evento.detail;

            if (pontos.length < 3) {
                alert("É preciso manter pelo menos 3 pontos para formar um perímetro.");
                return;
            }

            const poligono = this.projeto.terreno_convexo
                ? calcularCascoConvexo(pontos)
                : simplificarTrilha(pontos);

            if (poligono.length < 3) {
                alert("Poucos pontos restantes para formar um perímetro. Não é possível salvar.");
                return;
            }

            if (!this.projeto.terreno_convexo) {
                const { fechamentoOk, distanciaFechamento } = avaliarFechamento(poligono);
                if (!fechamentoOk) {
                    const continuar = confirm(
                        `O ponto final ficou a ${distanciaFechamento.toFixed(0)} m do ponto inicial — ` +
                        "pode não ter fechado a volta completa da propriedade. Salvar mesmo assim?"
                    );
                    if (!continuar) return;
                }
            }

            const trilha = await plantaTerraDB.obterTrilha(this._trilhaEmEdicaoId);
            await plantaTerraDB.salvarTrilha({ ...trilha, pontos_brutos: pontos, poligono });

            editor.fechar();
            await this._renderizarHistoricoPerimetro();
            await this.recarregarTudo();
        });
    }

    _abrirEditorPontosTrilha(trilha) {
        this._trilhaEmEdicaoId = trilha.id;
        // Modo de tela cheia: esconde as demais seções (não fica só visualmente
        // por trás — ficavam clicáveis também) e o mapa cresce para ocupar
        // quase toda a tela, dando espaço de verdade para tocar nos pontos.
        this.querySelector(".painel-inferior").hidden = true;
        this.mapaElemento.invalidarTamanho();
        this._editorPontos.abrir({ pontos: trilha.pontos_brutos ?? [] });
    }

    // ---------------- Estações e leituras ----------------

    /**
     * Estações e leituras: <dialogo-estacao>, <dialogo-leitura> e <lista-estacoes>
     * só mostram e avisam; aqui ficam o GPS (<captura-gps>), o banco e a recarga.
     */
    _wireEstacoes() {
        const dialogoEstacao = this.querySelector("dialogo-estacao");
        const dialogoLeitura = this.querySelector("dialogo-leitura");
        const lista = this.querySelector("lista-estacoes");

        const capturar = () => this.capturaGps.abrir();
        dialogoEstacao.capturador = capturar;
        dialogoLeitura.capturador = capturar;

        this.querySelector('[data-acao="nova-estacao"]').addEventListener("click", () => {
            dialogoEstacao.abrir({
                estacoesParaAmarrar: this.estacoesComLeituras
                    .filter(({ leituras }) => leituras.some(l => l.eh_ponto_amarracao))
                    .map(({ estacao }) => ({ id: estacao.id, nome: estacao.nome }))
            });
        });

        dialogoEstacao.addEventListener("estacao-criada", async evento => {
            await plantaTerraDB.criarEstacao({ projetoId: this.projetoId, ...evento.detail });
            dialogoEstacao.fechar();
            await this.recarregarTudo();
        });

        lista.addEventListener("nova-leitura-solicitada", evento => {
            const { estacao } = this.estacoesComLeituras.find(item => item.estacao.id === evento.detail.estacaoId);
            this._estacaoAtualParaLeitura = estacao;
            dialogoLeitura.abrir();
        });

        dialogoLeitura.addEventListener("leitura-criada", async evento => {
            if (!this._estacaoAtualParaLeitura) return;
            await this._salvarNovaLeitura(this._estacaoAtualParaLeitura, evento.detail);
            dialogoLeitura.fechar();
            await this.recarregarTudo();
        });
    }

    /**
     * Salva uma leitura e, se ela for o ponto de amarração que resolve o
     * offset_altitude de uma estação recém-amarrada, calcula esse offset e
     * recalcula a altitude relativa de todas as leituras da estação.
     * Ver docs/especificacao.md secao 4.
     */
    async _salvarNovaLeitura(estacao, { coordenada, alturaMira, ehPontoAmarracao }) {
        const precisaResolverAmarracao =
            ehPontoAmarracao && estacao.amarrada_a_estacao_id && estacao.offset_altitude === 0;

        if (precisaResolverAmarracao) {
            const estacaoReferencia = this.estacoesComLeituras.find(
                ({ estacao: e }) => e.id === estacao.amarrada_a_estacao_id
            );
            const leituraDeReferencia = estacaoReferencia?.leituras.find(l => l.eh_ponto_amarracao);

            if (leituraDeReferencia) {
                estacao.offset_altitude = calcularOffsetPorAmarracao(
                    alturaMira,
                    estacao,
                    leituraDeReferencia.altitude_relativa
                );
                await plantaTerraDB.atualizarEstacao(estacao);

                const leiturasExistentes = await plantaTerraDB.listarLeituras(estacao.id);
                for (const leituraRecalculada of recalcularLeiturasDaEstacao(estacao, leiturasExistentes)) {
                    await plantaTerraDB.atualizarLeitura(leituraRecalculada);
                }
            }
        }

        const novaLeitura = await plantaTerraDB.criarLeitura({
            estacaoId: estacao.id,
            coordenada,
            alturaMira,
            ehPontoAmarracao
        });
        novaLeitura.altitude_relativa = calcularAltitudeLeitura(estacao, alturaMira);
        await plantaTerraDB.atualizarLeitura(novaLeitura);
    }

    _renderizarListaEstacoes() {
        this.querySelector("lista-estacoes").estacoes = this.estacoesComLeituras;
    }

    // ---------------- Curvas de nível ----------------

    _wireCurvasDeNivel() {
        this.querySelector('[data-acao="gerar-curvas"]').addEventListener("click", () => {
            const pontos = consolidarPontosDoProjeto(this.estacoesComLeituras);

            if (pontos.length < 3) {
                alert("São necessárias ao menos 3 leituras com altitude calculada para gerar curvas de nível.");
                return;
            }

            const { isolinhas, semDados } = gerarCurvasDeNivel(pontos, this.trilhaAtiva?.poligono ?? null);
            if (semDados) {
                alert("Não há dados suficientes para calcular as curvas de nível.");
                return;
            }

            this.mapaElemento.definirIsolinhas(isolinhas);
        });
    }

    // ---------------- SAF / linhas de plantio ----------------

    disconnectedCallback() {
        this._pararAndar?.();
    }

    // ---------------- Navegação entre vistas (docs/especificacao.md secao 14.10) ----------------

    /**
     * O projeto tem uma tela de entrada (três cartões) e uma vista por assunto:
     * perímetro, estações de nível e SAF. A última vista é lembrada para que o
     * app reabra no lugar onde a pessoa estava (muitas vezes, a agrofloresta).
     */
    _wireNavegacao() {
        const entrada = this.querySelector(".vista-entrada");
        const secoes = this.querySelector(".secoes-padrao");
        const vistaSaf = this.querySelector(".vista-saf");
        const painelInferior = this.querySelector(".painel-inferior");
        const botaoAmpliar = this.querySelector('[data-acao="mapa-ampliar"]');

        this._vista = "entrada";

        this._irParaVista = async vista => {
            this.querySelector("dialogo-planta-metro")?.fechar();
            this.classList.remove("foco-metro");
            if (this._vista === "saf" && vista !== "saf") {
                this._pararAndar();
                this.mapaElemento.limparLinhasDestacadas();
            }
            this._vista = vista;

            entrada.hidden = vista !== "entrada";
            secoes.hidden = vista !== "perimetro" && vista !== "estacoes";
            secoes.querySelectorAll("[data-vista-secao]").forEach(secao => {
                secao.hidden = secao.dataset.vistaSecao !== vista;
            });
            vistaSaf.hidden = vista !== "saf";
            painelInferior.classList.toggle("painel-saf", vista === "saf");
            this.classList.toggle("vista-saf-ativa", vista === "saf");
            botaoAmpliar.hidden = vista !== "saf";
            this._definirMapaAmpliado(false);

            if (vista === "saf") {
                await this._abrirVistaSaf();
            } else {
                this.mapaElemento.ajustarZoomParaConteudo();
            }
            this._lembrarLugar();
            this._renderizarMigalhas();
        };

        this._definirMapaAmpliado = ampliado => {
            this.classList.toggle("mapa-ampliado", ampliado);
            botaoAmpliar.textContent = ampliado ? "⤡" : "⤢";
            botaoAmpliar.setAttribute("aria-label", ampliado ? "Reduzir mapa" : "Ampliar mapa");
            // O contêiner muda de tamanho por CSS; o mapa precisa recalcular o canvas.
            requestAnimationFrame(() => this.mapaElemento.invalidarTamanho());
        };

        botaoAmpliar.addEventListener("click", () => {
            this._definirMapaAmpliado(!this.classList.contains("mapa-ampliado"));
        });

        // Migalhas: "projeto" volta à entrada; os demais níveis só fecham o painel de plantas (se aberto).
        this.querySelector(".migalhas").addEventListener("click", evento => {
            const nivel = evento.target.closest("[data-nivel]")?.dataset.nivel;
            if (!nivel) return;
            if (nivel === "projeto") this._irParaVista("entrada");
            else this.querySelector("dialogo-planta-metro")?.fechar();
        });

        entrada.querySelectorAll("[data-vista]").forEach(cartao => {
            cartao.addEventListener("click", () => this._irParaVista(cartao.dataset.vista));
        });

        // "←": numa vista volta para a entrada; na entrada volta para a lista de projetos.
        this.querySelector(".cabecalho-projeto > .botao-voltar").addEventListener("click", evento => {
            // "←" fecha primeiro a camada que estiver por cima (painel de plantas, editor de pontos);
            // sem isso a tela mudava por baixo e a camada ficava presa por cima da entrada.
            const painelPlantas = this.querySelector("dialogo-planta-metro");
            if (painelPlantas?.aberto) {
                evento.preventDefault();
                painelPlantas.fechar();
                return;
            }
            if (this._editorPontos?.aberto) {
                evento.preventDefault();
                // Mesmo caminho do botão "Fechar" do editor (confirma se houver alterações).
                this._editorPontos.querySelector('[data-acao="fechar-editar-pontos"]').click();
                return;
            }
            if (this._vista !== "entrada") {
                evento.preventDefault();
                this._irParaVista("entrada");
            } else {
                localStorage.removeItem(CHAVE_ULTIMO_LUGAR);
            }
        });
    }

    _lembrarLugar() {
        try {
            localStorage.setItem(CHAVE_ULTIMO_LUGAR, JSON.stringify({
                projetoId: this.projetoId,
                vista: this._vista,
                safId: this._safAtualId ?? null
            }));
        } catch { /* armazenamento indisponível: só não reabre no mesmo lugar */ }
    }

    _lugarLembrado() {
        try {
            const lugar = JSON.parse(localStorage.getItem(CHAVE_ULTIMO_LUGAR));
            return lugar?.projetoId === this.projetoId ? lugar : null;
        } catch {
            return null;
        }
    }

    _atualizarResumos() {
        const resumo = seletor => this.querySelector(seletor);

        resumo(".resumo-perimetro").textContent = this.trilhaAtiva?.poligono?.length >= 3
            ? formatarArea(areaPoligonoMetros2(this.trilhaAtiva.poligono))
            : "ainda não mapeado";

        const totalLeituras = this.estacoesComLeituras.reduce((soma, item) => soma + (item.leituras?.length ?? 0), 0);
        resumo(".resumo-estacoes").textContent = this.estacoesComLeituras.length === 0
            ? "nenhuma estação ainda"
            : `${this.estacoesComLeituras.length} estação(ões) · ${totalLeituras} leitura(s)`;

        const totalLinhas = this.safsComLinhas.reduce((soma, { linhas }) => soma + linhas.length, 0);
        resumo(".resumo-saf").textContent = this.safsComLinhas.length === 0
            ? "nenhum SAF importado ainda"
            : `${this.safsComLinhas.length} SAF(s) · ${totalLinhas} linha(s)`;
    }

    // ---------------- Vista SAF: matriz + modo "Andar" (docs/especificacao.md secoes 14.5a, 14.9) ----------------

    async _abrirVistaSaf() {
        const lugar = this._lugarLembrado();
        if (lugar?.safId && !this._safAtualId) this._safAtualId = lugar.safId;
        await this._recarregarVistaSaf({ ajustarZoom: true });
    }

    /**
     * Lê do banco linhas e plantas de TODOS os SAFs (o "Andar" muda de SAF
     * sozinho conforme a pessoa se move) e desenha seletor, matriz e mapa.
     */
    async _recarregarVistaSaf({ ajustarZoom = false } = {}) {
        const safsComLinhas = (await plantaTerraDB.listarTodasLinhasDoProjeto(this.projetoId))
            .filter(({ linhas }) => linhas.length > 0);
        const todasLinhas = safsComLinhas.flatMap(({ linhas }) => linhas);
        const plantasPorLinha = await Promise.all(todasLinhas.map(l => plantaTerraDB.listarPlantasDaLinha(l.id)));

        // O diálogo de planta lê estes dois mapas.
        this._linhasDoSafEmEdicaoPorId = new Map(todasLinhas.map(l => [l.id, l]));
        this._plantasPorLinhaEmEdicao = new Map(todasLinhas.map((l, i) => [l.id, plantasPorLinha[i]]));

        this._dadosSaf = safsComLinhas.map(({ saf, linhas }) => ({ saf, linhas, matriz: calcularMatrizSaf(linhas) }));
        this._quadradosSaf = this._dadosSaf.flatMap(({ saf, matriz }) =>
            matriz.linhasLogicas.flatMap(fileira => fileira.quadrados.map(q => ({ ...q, safId: saf.id, chave: `${q.linhaId}|${q.indiceMetro}` })))
        );
        this.querySelector("andar-gps").quadrados = this._quadradosSaf;

        if (!this._dadosSaf.some(d => d.saf.id === this._safAtualId)) {
            this._safAtualId = this._dadosSaf[0]?.saf.id ?? null;
        }
        this._renderizarVistaSaf({ ajustarZoom });
    }

    _renderizarVistaSaf({ ajustarZoom = false } = {}) {
        const vista = this.querySelector(".vista-saf");
        const seletor = vista.querySelector(".saf-seletor");
        const info = vista.querySelector(".editor-saf-info");
        const matrizElemento = vista.querySelector("matriz-saf");

        const atual = this._dadosSaf.find(d => d.saf.id === this._safAtualId);
        if (!atual) {
            seletor.innerHTML = "";
            info.textContent = "Nenhum SAF com linhas de plantio ainda. Use o menu ⋮ → Importar → KMZ/KML.";
            matrizElemento.limpar();
            this.mapaElemento.limparLinhasDestacadas();
            return;
        }

        seletor.hidden = this._dadosSaf.length < 2;
        seletor.innerHTML = this._dadosSaf.map(({ saf }) => `
            <button type="button" class="saf-chip${saf.id === this._safAtualId ? " saf-chip-ativo" : ""}" data-saf-id="${saf.id}">
                ${escaparHtml(saf.nome)}
            </button>`).join("");

        const totalPlantas = atual.linhas.reduce((soma, l) => soma + (this._plantasPorLinhaEmEdicao.get(l.id)?.length ?? 0), 0);
        info.textContent = `${atual.linhas.length} linha(s) · ${atual.matriz.linhasLogicas.length} fileira(s) · ${totalPlantas} planta(s)`;

        matrizElemento.definir({ matriz: atual.matriz, plantasPorLinha: this._plantasPorLinhaEmEdicao });

        const partesParaMapa = atual.linhas.map(linha => {
            const plantasPorMetro = agruparPlantasPorMetro(this._plantasPorLinhaEmEdicao.get(linha.id));
            const { segmentos } = dividirEmMetros(linha.geometria);
            const pontosPlantados = [...plantasPorMetro.entries()]
                .map(([indiceMetro, plantasDoMetro]) => ({ indiceMetro, coordenada: segmentos[indiceMetro]?.meio, plantas: plantasDoMetro }))
                .filter(ponto => ponto.coordenada);
            return { linha, pontosPlantados };
        });
        this.mapaElemento.destacarLinhas(partesParaMapa, { ajustarZoom });

        this._aplicarMarcasAndar();
        this._renderizarMigalhas();
    }

    _escolherSaf(safId, { ajustarZoom = true } = {}) {
        if (safId === this._safAtualId) return;
        this._safAtualId = safId;
        this._renderizarVistaSaf({ ajustarZoom });
        this._lembrarLugar();
    }

    // Plantas mudam na vista SAF: recarrega mantendo a rolagem da matriz.
    async _recarregarAposMudarPlantas() {
        await this._recarregarVistaSaf();
    }

    /**
     * Liga os componentes da vista SAF entre si: <andar-gps> (onde a pessoa está),
     * <matriz-saf> (as fileiras) e o mapa. Cada um só conhece os próprios eventos.
     */
    _wireVistaSaf() {
        const vista = this.querySelector(".vista-saf");
        const matriz = vista.querySelector("matriz-saf");
        const andar = vista.querySelector("andar-gps");
        const abas = vista.querySelectorAll(".saf-modo");

        const definirAba = modo => abas.forEach(aba => aba.classList.toggle("saf-modo-ativo", aba.dataset.modo === modo));

        this._pararAndar = () => {
            andar.parar();
            matriz.modoAndar = false;
            definirAba("atual");
            this.mapaElemento?.limparModoAndar();
            this._ultimaAvaliacaoAndar = null;
            this._aplicarMarcasAndar();
        };

        abas.forEach(aba => aba.addEventListener("click", () => {
            if (aba.dataset.modo === "andar") {
                if (andar.ativo) return;
                andar.iniciar();
                matriz.modoAndar = andar.ativo;
                if (andar.ativo) definirAba("andar");
            } else {
                this._pararAndar();
            }
        }));

        // Mapa e matriz seguem o que o <andar-gps> informa.
        andar.addEventListener("posicao", evento => {
            const { posicao, proximos, maisProximo, atuando, centralizar, primeiroSinal } = evento.detail;
            this._ultimaAvaliacaoAndar = { proximos, maisProximo };
            this.mapaElemento.definirPosicaoUsuario(posicao);
            // Zoom de aproximação só no primeiro sinal; depois vale o zoom da pessoa.
            if (centralizar) this.mapaElemento.seguirPosicao(posicao.lat, posicao.lon, primeiroSinal ? 21 : null);

            if (atuando) this._escolherSaf(maisProximo.safId, { ajustarZoom: false });
            this._aplicarMarcasAndar();
            if (atuando) matriz.rolarPara(maisProximo.chave);

            const plantado = q => (this._plantasPorLinhaEmEdicao.get(q.linhaId) ?? []).some(p => p.indice_metro === q.indiceMetro);
            this.mapaElemento.definirMetrosProximos(
                proximos.map(q => ({ chave: q.chave, indiceMetro: q.indiceMetro, coordenada: q.coordenada, plantado: plantado(q) })),
                maisProximo?.chave ?? null,
                chave => this._abrirMetroPorChave(chave)
            );
        });
        andar.addEventListener("rumo", evento => this.mapaElemento.girarParaRumo(evento.detail.graus));
        andar.addEventListener("rumo-ativo", evento => this.mapaElemento.definirRotacaoAutomatica(evento.detail.ativo));

        // A pessoa pegou o controle: tocar/rolar a matriz, trocar de SAF ou arrastar o mapa pausa o GPS-guia.
        matriz.addEventListener("controle-assumido", () => andar.assumirControle());
        this.mapaElemento.aoArrastarManualmente(() => andar.assumirControle());

        vista.querySelector(".saf-seletor").addEventListener("click", evento => {
            const chip = evento.target.closest("[data-saf-id]");
            if (!chip) return;
            andar.assumirControle();
            this._escolherSaf(chip.dataset.safId);
        });

        // Tocar numa célula abre o diálogo de planta e leva o mapa até o metro.
        matriz.addEventListener("metro-tocado", evento => {
            const { linhaId, indiceMetro, coordenada } = evento.detail;
            this._abrirDialogoMetro(this._linhasDoSafEmEdicaoPorId.get(linhaId), indiceMetro, coordenada);
        });

        this._aplicarMarcasAndar = () => {
            const avaliacao = this._ultimaAvaliacaoAndar;
            matriz.marcarProximos(avaliacao?.proximos.map(q => q.chave) ?? [], avaliacao?.maisProximo?.chave ?? null);
        };

        this._abrirMetroPorChave = chave => {
            const quadrado = this._quadradosSaf.find(q => q.chave === chave);
            if (!quadrado) return;
            andar.assumirControle();
            this._abrirDialogoMetro(this._linhasDoSafEmEdicaoPorId.get(quadrado.linhaId), quadrado.indiceMetro, quadrado.coordenada);
        };
    }

    /**
     * Importação de KMZ/KML: aqui ficam a leitura do arquivo e a gravação; a
     * pré-visualização é o <dialogo-importar-saf>.
     */
    _wireSaf() {
        const dialogo = this.querySelector("dialogo-importar-saf");

        this.querySelector('[data-acao="importar-arquivo-saf"]').addEventListener("change", async evento => {
            const arquivo = evento.target.files[0];
            evento.target.value = "";
            if (!arquivo) return;

            try {
                dialogo.abrir(await analisarArquivoParaImportacao(arquivo));
            } catch (erro) {
                alert(`Não foi possível ler o arquivo: ${erro.message}`);
            }
        });

        dialogo.addEventListener("importacao-confirmada", async evento => {
            await importarParaProjeto(this.projetoId, evento.detail.safsEncontradas, evento.detail.elementosContexto);
            dialogo.fechar();
            await this.recarregarTudo();
        });

        this._wireDialogoPlanta();
    }

    /**
     * Diálogo das plantas de um metro: o componente <dialogo-planta-metro> só
     * mostra e avisa; aqui ficam o banco, o mapa e a recarga dos dados.
     */
    _wireDialogoPlanta() {
        const dialogo = this.querySelector("dialogo-planta-metro");

        this._abrirDialogoMetro = async (linha, indiceMetro, coordenada) => {
            this._linhaAtualParaPlanta = linha;
            this._metroEmEdicao = indiceMetro;
            if (coordenada) this._coordenadaMetroAtual = coordenada;

            const rotuloLinha = linha.numero_linha !== null ? `Linha ${linha.numero_linha}` : linha.nome_original;
            // Com mais de um SAF no projeto, "Linha 1" sozinho é ambíguo.
            const safDaLinha = this.safsComLinhas.find(({ saf }) => saf.id === linha.saf_id)?.saf;
            const prefixoSaf = this.safsComLinhas.length > 1 && safDaLinha ? `${safDaLinha.nome} · ` : "";

            this.querySelector("matriz-saf").selecionar(`${linha.id}|${indiceMetro}`);

            // Modo foco: o mapa mantém o tamanho e o painel de plantas ocupa o resto (a matriz some até fechar),
            // para a pessoa ver onde está o metro sem o painel cobrir o mapa.
            this.classList.add("foco-metro");
            this._rotuloMetroAberto = `${rotuloLinha} · metro ${indiceMetro}`;

            // O mapa mostra onde fica este metro (rótulo + zoom de 1 m), para a pessoa se situar no campo.
            this.mapaElemento.destacarSegmentoAtivo(this._coordenadaMetroAtual, {
                rotulo: `${prefixoSaf}${rotuloLinha} · metro ${indiceMetro}`,
                zoomMinimo: 21
            });

            // A biblioteca é global e pode ter mudado em outra tela: relê a cada abertura.
            if (!dialogo.aberto) dialogo.especies = await plantaTerraDB.listarEspecies();
            await dialogo.abrir({
                titulo: `${prefixoSaf}${rotuloLinha} — metro ${indiceMetro}`,
                plantas: (this._plantasPorLinhaEmEdicao.get(linha.id) ?? []).filter(p => p.indice_metro === indiceMetro)
            });
            this._renderizarMigalhas();
        };

        dialogo.addEventListener("fechado", () => {
            this.classList.remove("foco-metro");
            this._renderizarMigalhas();
            // Se o GPS estava guiando, a matriz volta já na posição certa.
            const andar = this.querySelector("andar-gps");
            const maisProximo = this._ultimaAvaliacaoAndar?.maisProximo;
            if (andar?.seguindo && maisProximo) this.querySelector("matriz-saf").rolarPara(maisProximo.chave);
        });

        dialogo.addEventListener("planta-adicionada", async evento => {
            await plantaTerraDB.criarPlanta({
                linhaId: this._linhaAtualParaPlanta.id,
                indiceMetro: this._metroEmEdicao,
                ...evento.detail
            });
            await this._recarregarAposMudarPlantas();
            this._abrirDialogoMetro(this._linhaAtualParaPlanta, this._metroEmEdicao);
        });

        dialogo.addEventListener("planta-removida", async evento => {
            await plantaTerraDB.removerPlanta(evento.detail.id);
            await this._recarregarAposMudarPlantas();
            this._abrirDialogoMetro(this._linhaAtualParaPlanta, this._metroEmEdicao);
        });
    }
}

customElements.define("painel-projeto", PainelProjeto);
