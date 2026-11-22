import { plantaTerraDB } from "../db/plantaterra_db.js";
import { exportarProjeto } from "../db/exportador_projeto.js";
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
import { normalizarNome } from "../dominio/biblioteca_plantas.js";
import { analisarArquivoParaImportacao, importarParaProjeto } from "../kml/importador_saf.js";
import { escaparHtml, formatarMetros, formatarArea, formatarData, formatarDataSimples, parsearDataBr } from "./util_dom.js";
import "./mapa_projeto.js";
import "./captura_gps.js";
import "./matriz_saf.js";
import "./andar_gps.js";

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
                    <h1>${escaparHtml(this.projeto.nome)}</h1>
                    <button type="button" data-acao="abrir-exportar" class="botao-icone" aria-label="Exportar projeto">⭳</button>
                </header>

                <dialog class="dialogo-exportar">
                    <h2>Exportar projeto</h2>
                    <div class="acoes-formulario acoes-formulario-coluna">
                        <button type="button" data-acao="exportar-backup" class="botao-secundario botao-largo">
                            Backup do projeto (.json)
                        </button>
                        <button type="button" data-acao="exportar-geojson" class="botao-secundario botao-largo">
                            GeoJSON — QGIS, Mapbox etc. (.geojson)
                        </button>
                        <button type="button" data-acao="exportar-kml" class="botao-secundario botao-largo">
                            KML — Google Earth (.kml)
                        </button>
                        <button type="button" data-acao="exportar-kmz" class="botao-secundario botao-largo">
                            KMZ completo — Google Earth (.kmz)
                        </button>
                        <button type="button" data-acao="fechar-exportar">Fechar</button>
                    </div>
                </dialog>

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
                            <ul class="lista-estacoes"></ul>
                        </section>

                        <section class="secao-curvas" data-vista-secao="estacoes">
                            <button type="button" data-acao="gerar-curvas" class="botao-secundario botao-largo">
                                Gerar curvas de nível
                            </button>
                        </section>
                    </div>

                    <section class="vista-saf" hidden>
                        <div class="secao-cabecalho">
                            <h2>Sistemas Agroflorestais (SAF)</h2>
                            <label class="botao-secundario botao-arquivo">
                                Importar KMZ/KML
                                <input type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" data-acao="importar-arquivo-saf" hidden />
                            </label>
                        </div>
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

                <div class="editor-pontos-trilha" hidden>
                    <p class="editar-pontos-status"></p>
                    <p class="editar-pontos-detalhe" hidden></p>
                    <div class="acoes-formulario">
                        <button type="button" class="botao-secundario" data-acao="excluir-ponto-selecionado" hidden>
                            Excluir ponto selecionado 🗑
                        </button>
                    </div>
                    <div class="acoes-formulario">
                        <button type="button" class="botao-primario" data-acao="salvar-edicao-pontos">Salvar alterações</button>
                        <button type="button" data-acao="fechar-editar-pontos">Fechar</button>
                    </div>
                </div>

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

                <dialog class="dialogo-historico-perimetro">
                    <h2>Histórico de rodadas do perímetro</h2>
                    <ul class="lista-historico-perimetro"></ul>
                    <div class="acoes-formulario">
                        <button type="button" data-acao="fechar-historico-perimetro">Fechar</button>
                    </div>
                </dialog>

                <dialog class="dialogo-estacao">
                    <form class="formulario-estacao">
                        <h2>Nova estação de nível</h2>
                        <p class="estacao-coordenada-status">Nenhuma coordenada capturada ainda.</p>
                        <button type="button" data-acao="capturar-coordenada-estacao" class="botao-secundario">
                            Capturar posição GPS
                        </button>
                        <label>Nome da estação
                            <input type="text" name="nome" required maxlength="60" />
                        </label>
                        <label>Altura do instrumento (m)
                            <input type="number" name="altura_instrumento" step="0.001" min="0" required />
                        </label>
                        <label class="campo-amarracao" hidden>Amarrar a
                            <select name="amarrada_a"></select>
                        </label>
                        <div class="acoes-formulario">
                            <button type="submit" class="botao-primario" disabled>Salvar estação</button>
                            <button type="button" data-acao="cancelar-estacao">Cancelar</button>
                        </div>
                    </form>
                </dialog>

                <dialog class="dialogo-leitura">
                    <form class="formulario-leitura">
                        <h2>Nova leitura</h2>
                        <p class="leitura-coordenada-status">Nenhuma coordenada capturada ainda.</p>
                        <button type="button" data-acao="capturar-coordenada-leitura" class="botao-secundario">
                            Capturar posição GPS
                        </button>
                        <label>Altura lida na mira (m)
                            <input type="number" name="altura_mira" step="0.001" min="0" required />
                        </label>
                        <label class="campo-checkbox">
                            <input type="checkbox" name="eh_ponto_amarracao" />
                            É o ponto de amarração com outra estação
                        </label>
                        <div class="acoes-formulario">
                            <button type="submit" class="botao-primario" disabled>Salvar leitura</button>
                            <button type="button" data-acao="cancelar-leitura">Cancelar</button>
                        </div>
                    </form>
                </dialog>

                <dialog class="dialogo-importar-saf">
                    <h2>Importar SAF/linhas de plantio</h2>
                    <div class="importar-saf-conteudo"></div>
                    <div class="acoes-formulario">
                        <button type="button" data-acao="confirmar-importacao-saf" class="botao-primario">Importar</button>
                        <button type="button" data-acao="cancelar-importacao-saf">Cancelar</button>
                    </div>
                </dialog>

                <dialog class="dialogo-planta-metro">
                    <h2 class="planta-metro-titulo"></h2>
                    <ul class="lista-plantas-metro"></ul>
                    <form class="formulario-planta">
                        <label>Espécie / nome da planta
                            <input type="text" name="especie" required maxlength="80" list="sugestoes-especies" autocomplete="off" />
                            <datalist id="sugestoes-especies"></datalist>
                        </label>
                        <label>Quantidade (opcional)
                            <input type="number" name="quantidade" min="1" step="1" />
                        </label>
                        <label>Observação (opcional)
                            <input type="text" name="observacao" maxlength="200" />
                        </label>
                        <label>Data de plantio (opcional)
                            <input type="text" name="data_plantio" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" />
                        </label>
                        <div class="acoes-formulario">
                            <button type="submit" class="botao-primario">Adicionar planta</button>
                            <button type="button" data-acao="fechar-planta-metro">Fechar</button>
                        </div>
                    </form>
                </dialog>
            </div>
        `;

        this.mapaElemento = this.querySelector("mapa-projeto");
        this.capturaGps = this.querySelector("captura-gps");

        this._wireExportar();
        this._wireTerrenoConvexo();
        this._wirePerimetro();
        this._wireEditorPontosTrilha();
        this._wireEstacoes();
        this._wireCurvasDeNivel();
        this._wireSaf();
        this._wireVistaSaf();
        this._wireNavegacao();

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

        const areaElemento = this.querySelector(".area-perimetro");
        areaElemento.textContent = trilhaAtiva?.poligono?.length >= 3
            ? formatarArea(areaPoligonoMetros2(trilhaAtiva.poligono))
            : "ainda não mapeado";

        this._renderizarListaEstacoes();
        this._atualizarResumos();
        if (this._vista === "saf") await this._recarregarVistaSaf();
    }

    // ---------------- Exportar ----------------

    _wireExportar() {
        const dialogo = this.querySelector(".dialogo-exportar");

        this.querySelector('[data-acao="abrir-exportar"]').addEventListener("click", () => dialogo.showModal());
        this.querySelector('[data-acao="fechar-exportar"]').addEventListener("click", () => dialogo.close());

        this.querySelector('[data-acao="exportar-backup"]').addEventListener("click", () => {
            exportarProjeto(this.projetoId);
            dialogo.close();
        });
        this.querySelector('[data-acao="exportar-geojson"]').addEventListener("click", () => {
            exportarGeoJSON(this.projetoId);
            dialogo.close();
        });
        this.querySelector('[data-acao="exportar-kml"]').addEventListener("click", () => {
            exportarKML(this.projetoId);
            dialogo.close();
        });
        this.querySelector('[data-acao="exportar-kmz"]').addEventListener("click", () => {
            exportarKMZ(this.projetoId);
            dialogo.close();
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

    _wireHistoricoPerimetro() {
        const dialogo = this.querySelector(".dialogo-historico-perimetro");
        const lista = this.querySelector(".lista-historico-perimetro");

        this.querySelector('[data-acao="abrir-historico-perimetro"]').addEventListener("click", async () => {
            await this._renderizarHistoricoPerimetro();
            dialogo.showModal();
        });

        this.querySelector('[data-acao="fechar-historico-perimetro"]').addEventListener("click", () => dialogo.close());

        lista.addEventListener("click", async evento => {
            const botao = evento.target.closest("button[data-acao]");
            if (!botao) return;

            const id = botao.closest(".item-historico-perimetro").dataset.id;

            if (botao.dataset.acao === "usar-rodada-perimetro") {
                await plantaTerraDB.definirTrilhaAtiva(this.projetoId, id);
                await this._renderizarHistoricoPerimetro();
                await this.recarregarTudo();
            } else if (botao.dataset.acao === "excluir-rodada-perimetro") {
                if (!confirm("Excluir esta rodada de captura do perímetro? Essa ação não pode ser desfeita.")) return;
                await plantaTerraDB.removerTrilha(id);
                await this._renderizarHistoricoPerimetro();
                await this.recarregarTudo();
            } else if (botao.dataset.acao === "editar-pontos-perimetro") {
                const trilha = await plantaTerraDB.obterTrilha(id);
                dialogo.close();
                this._abrirEditorPontosTrilha(trilha);
            } else if (botao.dataset.acao === "exportar-kml-rodada") {
                const trilha = await plantaTerraDB.obterTrilha(id);
                exportarKMLTrilha(trilha, this.projeto.nome);
            } else if (botao.dataset.acao === "renomear-rodada") {
                this._editandoNomeTrilhaId = id;
                await this._renderizarHistoricoPerimetro();
            }
        });

        lista.addEventListener("change", async evento => {
            const checkbox = evento.target.closest('[data-acao="alternar-visivel-rodada"]');
            if (!checkbox) return;

            const id = checkbox.closest(".item-historico-perimetro").dataset.id;
            const trilha = await plantaTerraDB.obterTrilha(id);
            await plantaTerraDB.salvarTrilha({ ...trilha, visivel: checkbox.checked });
            await this.recarregarTudo();
        });
    }

    async _renderizarHistoricoPerimetro() {
        const lista = this.querySelector(".lista-historico-perimetro");
        const trilhas = (await plantaTerraDB.listarTrilhas(this.projetoId))
            .sort((a, b) => b.criado_em - a.criado_em);

        if (trilhas.length === 0) {
            lista.innerHTML = `<li class="lista-vazia">Nenhuma rodada capturada ainda.</li>`;
            return;
        }

        lista.innerHTML = trilhas.map(trilha => {
            const nome = trilha.nome || `Perímetro ${formatarData(trilha.criado_em)}`;
            const visivel = trilha.visivel !== false;
            const emEdicao = this._editandoNomeTrilhaId === trilha.id;

            return `
            <li class="item-historico-perimetro" data-id="${trilha.id}">
                <span>
                    ${emEdicao
                        ? `<input type="text" class="input-nome-rodada" value="${escaparHtml(nome)}" maxlength="60" />`
                        : `<strong>${escaparHtml(nome)}</strong>
                           <button type="button" class="botao-icone-inline" data-acao="renomear-rodada" aria-label="Renomear">✏️</button>`
                    }
                    ${trilha.ativo ? " — principal" : ""}
                    <br>
                    ${trilha.poligono?.length >= 3 ? formatarArea(areaPoligonoMetros2(trilha.poligono)) : "polígono incompleto"}
                    · ${formatarData(trilha.criado_em)}
                    <label class="campo-checkbox">
                        <input type="checkbox" data-acao="alternar-visivel-rodada" ${visivel ? "checked" : ""} />
                        Visível no mapa
                    </label>
                </span>
                <span class="acoes-item-historico">
                    <button type="button" class="botao-secundario" data-acao="editar-pontos-perimetro">Editar pontos</button>
                    ${trilha.poligono?.length >= 3
                        ? `<button type="button" class="botao-secundario" data-acao="exportar-kml-rodada">Exportar KML</button>`
                        : ""}
                    ${trilha.ativo ? "" : `<button type="button" class="botao-secundario" data-acao="usar-rodada-perimetro">Definir como principal</button>`}
                    <button type="button" class="botao-excluir" data-acao="excluir-rodada-perimetro" aria-label="Excluir">🗑</button>
                </span>
            </li>
        `;
        }).join("");

        if (this._editandoNomeTrilhaId) {
            const input = lista.querySelector(".input-nome-rodada");
            if (input) {
                input.focus();
                input.select();

                const commit = async () => {
                    const id = this._editandoNomeTrilhaId;
                    this._editandoNomeTrilhaId = null;
                    const trilha = await plantaTerraDB.obterTrilha(id);
                    await plantaTerraDB.salvarTrilha({ ...trilha, nome: input.value.trim() || null });
                    await this._renderizarHistoricoPerimetro();
                    await this.recarregarTudo();
                };

                input.addEventListener("blur", commit, { once: true });
                input.addEventListener("keydown", evento => {
                    if (evento.key === "Enter") {
                        input.blur();
                    } else if (evento.key === "Escape") {
                        input.removeEventListener("blur", commit);
                        this._editandoNomeTrilhaId = null;
                        this._renderizarHistoricoPerimetro();
                    }
                });
            }
        }
    }

    /**
     * Editor de pontos brutos de uma rodada de captura já salva: mostra cada
     * ponto no mapa em gradiente (azul = mais antigo, vermelho = mais
     * recente), permite selecionar um ponto clicando nele e excluí-lo, e só
     * grava no banco (recalculando o polígono) quando o usuário confirma.
     */
    _wireEditorPontosTrilha() {
        const painel = this.querySelector(".editor-pontos-trilha");
        const status = this.querySelector(".editar-pontos-status");
        const detalhe = this.querySelector(".editar-pontos-detalhe");
        const botaoExcluirPonto = this.querySelector('[data-acao="excluir-ponto-selecionado"]');

        this.mapaElemento.addEventListener("ponto-trilha-clicado", evento => {
            if (!this._edicaoPontos) return;
            this._edicaoPontos.indiceSelecionado = evento.detail.indice;
            this._renderizarEditorPontosTrilha();
        });

        botaoExcluirPonto.addEventListener("click", () => {
            const estado = this._edicaoPontos;
            if (!estado || estado.indiceSelecionado === null) return;
            estado.pontos.splice(estado.indiceSelecionado, 1);
            estado.indiceSelecionado = null;
            estado.alterado = true;
            this._renderizarEditorPontosTrilha();
        });

        this.querySelector('[data-acao="fechar-editar-pontos"]').addEventListener("click", () => {
            if (this._edicaoPontos?.alterado && !confirm("Descartar as alterações feitas nos pontos desta rodada?")) {
                return;
            }
            this._fecharEditorPontosTrilha();
        });

        this.querySelector('[data-acao="salvar-edicao-pontos"]').addEventListener("click", async () => {
            const estado = this._edicaoPontos;
            if (!estado) return;

            if (estado.pontos.length < 3) {
                alert("É preciso manter pelo menos 3 pontos para formar um perímetro.");
                return;
            }

            const poligono = this.projeto.terreno_convexo
                ? calcularCascoConvexo(estado.pontos)
                : simplificarTrilha(estado.pontos);

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

            const trilha = await plantaTerraDB.obterTrilha(estado.trilhaId);
            await plantaTerraDB.salvarTrilha({ ...trilha, pontos_brutos: estado.pontos, poligono });

            this._fecharEditorPontosTrilha();
            await this._renderizarHistoricoPerimetro();
            await this.recarregarTudo();
        });

        this._editorPontosPainel = painel;
        this._editorPontosStatus = status;
        this._editorPontosDetalhe = detalhe;
        this._editorPontosBotaoExcluir = botaoExcluirPonto;
    }

    _abrirEditorPontosTrilha(trilha) {
        const pontos = trilha.pontos_brutos ?? [];
        this._edicaoPontos = {
            trilhaId: trilha.id,
            tMin: pontos[0]?.timestamp,
            tMax: pontos[pontos.length - 1]?.timestamp,
            pontos: pontos.slice(),
            indiceSelecionado: null,
            alterado: false
        };
        // Modo de tela cheia: esconde as demais seções (não fica só visualmente
        // por trás — ficavam clicáveis também) e o mapa cresce para ocupar
        // quase toda a tela, dando espaço de verdade para tocar nos pontos.
        this.querySelector(".painel-inferior").hidden = true;
        this._editorPontosPainel.hidden = false;
        this.mapaElemento.invalidarTamanho();

        this._renderizarEditorPontosTrilha({ ajustarZoom: true });
    }

    _renderizarEditorPontosTrilha({ ajustarZoom = false } = {}) {
        const estado = this._edicaoPontos;
        if (!estado) return;

        this._editorPontosStatus.textContent =
            `${estado.pontos.length} pontos — toque em um ponto no mapa para selecioná-lo.`;

        this.mapaElemento.exibirPontosTrilhaEditavel(estado.pontos, {
            indiceSelecionado: estado.indiceSelecionado,
            tMin: estado.tMin,
            tMax: estado.tMax,
            ajustarZoom
        });

        const ponto = estado.indiceSelecionado !== null ? estado.pontos[estado.indiceSelecionado] : null;
        this._editorPontosDetalhe.hidden = !ponto;
        this._editorPontosBotaoExcluir.hidden = !ponto;
        if (ponto) {
            const precisao = ponto.precisao != null ? `${ponto.precisao.toFixed(0)} m` : "desconhecida";
            this._editorPontosDetalhe.textContent = `Ponto selecionado: ${formatarData(ponto.timestamp)} — precisão ${precisao}`;
        }

        if (this.projeto.terreno_convexo) {
            this.mapaElemento.definirPreviaPoligono(calcularCascoConvexo(estado.pontos));
        } else {
            this.mapaElemento.limparPreviaPoligono();
        }
    }

    _fecharEditorPontosTrilha() {
        this._edicaoPontos = null;
        this.mapaElemento.limparPreviaPoligono();
        this.mapaElemento.limparPontosTrilhaEditavel();

        this._editorPontosPainel.hidden = true;
        this.querySelector(".painel-inferior").hidden = false;
        this.mapaElemento.invalidarTamanho();
        this.mapaElemento.ajustarZoomParaConteudo();
    }

    // ---------------- Estações e leituras ----------------

    _wireEstacoes() {
        const dialogoEstacao = this.querySelector(".dialogo-estacao");
        const formularioEstacao = this.querySelector(".formulario-estacao");
        const statusCoordenadaEstacao = this.querySelector(".estacao-coordenada-status");
        const botaoSalvarEstacao = formularioEstacao.querySelector('button[type="submit"]');
        const campoAmarracao = formularioEstacao.querySelector(".campo-amarracao");
        const selectAmarracao = campoAmarracao.querySelector("select");

        this.querySelector('[data-acao="nova-estacao"]').addEventListener("click", async () => {
            formularioEstacao.reset();
            this._coordenadaCapturadaEstacao = null;
            statusCoordenadaEstacao.textContent = "Nenhuma coordenada capturada ainda.";
            botaoSalvarEstacao.disabled = true;

            const estacoesComAmarracaoDisponivel = this.estacoesComLeituras.filter(
                ({ leituras }) => leituras.some(l => l.eh_ponto_amarracao)
            );

            if (estacoesComAmarracaoDisponivel.length > 0) {
                selectAmarracao.innerHTML =
                    `<option value="">Nenhuma (esta será uma referência independente)</option>` +
                    estacoesComAmarracaoDisponivel.map(({ estacao }) =>
                        `<option value="${estacao.id}">${escaparHtml(estacao.nome)}</option>`
                    ).join("");
                campoAmarracao.hidden = false;
            } else {
                campoAmarracao.hidden = true;
            }

            dialogoEstacao.showModal();
        });

        this.querySelector('[data-acao="cancelar-estacao"]').addEventListener("click", () => dialogoEstacao.close());

        this.querySelector('[data-acao="capturar-coordenada-estacao"]').addEventListener("click", async () => {
            statusCoordenadaEstacao.textContent = "Capturando…";
            const resultado = await this.capturaGps.abrir();
            if (!resultado) {
                statusCoordenadaEstacao.textContent = "Não foi possível obter uma posição GPS. Tente novamente.";
                return;
            }
            this._coordenadaCapturadaEstacao = resultado;
            statusCoordenadaEstacao.textContent =
                `Capturado: ${resultado.lat.toFixed(6)}, ${resultado.lon.toFixed(6)} (±${resultado.precisao.toFixed(1)} m)`;
            botaoSalvarEstacao.disabled = false;
        });

        formularioEstacao.addEventListener("submit", async evento => {
            evento.preventDefault();
            if (!this._coordenadaCapturadaEstacao) return;

            const dados = new FormData(formularioEstacao);
            const amarradaAEstacaoId = dados.get("amarrada_a") || null;

            await plantaTerraDB.criarEstacao({
                projetoId: this.projetoId,
                nome: dados.get("nome").trim(),
                coordenada: {
                    lat: this._coordenadaCapturadaEstacao.lat,
                    lon: this._coordenadaCapturadaEstacao.lon,
                    precisao: this._coordenadaCapturadaEstacao.precisao
                },
                alturaInstrumento: Number(dados.get("altura_instrumento")),
                amarradaAEstacaoId
            });

            dialogoEstacao.close();
            await this.recarregarTudo();
        });

        this._wireLeituras();
    }

    _wireLeituras() {
        const dialogoLeitura = this.querySelector(".dialogo-leitura");
        const formularioLeitura = this.querySelector(".formulario-leitura");
        const statusCoordenadaLeitura = this.querySelector(".leitura-coordenada-status");
        const botaoSalvarLeitura = formularioLeitura.querySelector('button[type="submit"]');

        this.querySelector('[data-acao="cancelar-leitura"]').addEventListener("click", () => dialogoLeitura.close());

        this.querySelector('[data-acao="capturar-coordenada-leitura"]').addEventListener("click", async () => {
            statusCoordenadaLeitura.textContent = "Capturando…";
            const resultado = await this.capturaGps.abrir();
            if (!resultado) {
                statusCoordenadaLeitura.textContent = "Não foi possível obter uma posição GPS. Tente novamente.";
                return;
            }
            this._coordenadaCapturadaLeitura = resultado;
            statusCoordenadaLeitura.textContent =
                `Capturado: ${resultado.lat.toFixed(6)}, ${resultado.lon.toFixed(6)} (±${resultado.precisao.toFixed(1)} m)`;
            botaoSalvarLeitura.disabled = false;
        });

        formularioLeitura.addEventListener("submit", async evento => {
            evento.preventDefault();
            if (!this._coordenadaCapturadaLeitura || !this._estacaoAtualParaLeitura) return;

            const dados = new FormData(formularioLeitura);
            await this._salvarNovaLeitura(this._estacaoAtualParaLeitura, {
                coordenada: {
                    lat: this._coordenadaCapturadaLeitura.lat,
                    lon: this._coordenadaCapturadaLeitura.lon,
                    precisao: this._coordenadaCapturadaLeitura.precisao
                },
                alturaMira: Number(dados.get("altura_mira")),
                ehPontoAmarracao: dados.get("eh_ponto_amarracao") === "on"
            });

            dialogoLeitura.close();
            await this.recarregarTudo();
        });

        this._abrirDialogoNovaLeitura = estacao => {
            formularioLeitura.reset();
            this._coordenadaCapturadaLeitura = null;
            this._estacaoAtualParaLeitura = estacao;
            statusCoordenadaLeitura.textContent = "Nenhuma coordenada capturada ainda.";
            botaoSalvarLeitura.disabled = true;
            dialogoLeitura.showModal();
        };
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
        const listaElemento = this.querySelector(".lista-estacoes");

        if (this.estacoesComLeituras.length === 0) {
            listaElemento.innerHTML = `<li class="lista-vazia">Nenhuma estação ainda.</li>`;
            return;
        }

        listaElemento.innerHTML = this.estacoesComLeituras.map(({ estacao, leituras }) => `
            <li class="item-estacao" data-id="${estacao.id}">
                <details>
                    <summary>
                        <strong>${escaparHtml(estacao.nome)}</strong>
                        <span>altura instr.: ${formatarMetros(estacao.altura_instrumento)}</span>
                        <span>offset: ${formatarMetros(estacao.offset_altitude)}</span>
                    </summary>
                    <ul class="lista-leituras">
                        ${leituras.map(leitura => `
                            <li class="item-leitura">
                                mira: ${formatarMetros(leitura.altura_mira)}
                                → altitude: ${formatarMetros(leitura.altitude_relativa, 2)}
                                ${leitura.eh_ponto_amarracao ? " 🔗 amarração" : ""}
                            </li>
                        `).join("")}
                    </ul>
                    <button type="button" class="botao-secundario" data-acao="nova-leitura">+ Leitura nesta estação</button>
                </details>
            </li>
        `).join("");

        listaElemento.querySelectorAll('[data-acao="nova-leitura"]').forEach(botao => {
            botao.addEventListener("click", () => {
                const id = botao.closest(".item-estacao").dataset.id;
                const { estacao } = this.estacoesComLeituras.find(item => item.estacao.id === id);
                this._abrirDialogoNovaLeitura(estacao);
            });
        });
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

        entrada.querySelectorAll("[data-vista]").forEach(cartao => {
            cartao.addEventListener("click", () => this._irParaVista(cartao.dataset.vista));
        });

        // "←": numa vista volta para a entrada; na entrada volta para a lista de projetos.
        this.querySelector(".botao-voltar").addEventListener("click", evento => {
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
            info.textContent = "Nenhum SAF com linhas de plantio ainda. Use \"Importar KMZ/KML\" acima.";
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
            if (centralizar) this.mapaElemento.seguirPosicao(posicao.lat, posicao.lon, primeiroSinal ? 20 : null);

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

    _wireSaf() {
        const dialogoImportar = this.querySelector(".dialogo-importar-saf");
        const conteudoImportar = this.querySelector(".importar-saf-conteudo");
        const botaoConfirmarImportacao = this.querySelector('[data-acao="confirmar-importacao-saf"]');

        this.querySelector('[data-acao="importar-arquivo-saf"]').addEventListener("change", async evento => {
            const arquivo = evento.target.files[0];
            evento.target.value = "";
            if (!arquivo) return;

            let analise;
            try {
                analise = await analisarArquivoParaImportacao(arquivo);
            } catch (erro) {
                alert(`Não foi possível ler o arquivo: ${erro.message}`);
                return;
            }

            this._analiseSafPendente = analise;
            const safsComLinhas = analise.safsEncontradas.filter(saf => saf.linhas.length > 0);
            const totalLinhas = safsComLinhas.reduce((soma, saf) => soma + saf.linhas.length, 0);
            const totalContexto = analise.elementosContexto.length;

            if (safsComLinhas.length === 0 && totalContexto === 0) {
                conteudoImportar.innerHTML = `<p>Nenhum SAF com linhas nem elemento de contexto foi reconhecido neste arquivo.</p>`;
                botaoConfirmarImportacao.hidden = true;
            } else {
                botaoConfirmarImportacao.hidden = false;
                conteudoImportar.innerHTML = "";

                if (safsComLinhas.length > 0) {
                    conteudoImportar.innerHTML += `
                        <p>${safsComLinhas.length} SAF(s), ${totalLinhas} linha(s) reconhecida(s):</p>
                        <ul class="lista-preview-saf">
                            ${safsComLinhas.map(saf => `
                                <li>
                                    <strong>${escaparHtml(saf.nomeOriginal)}</strong>
                                    <ul>
                                        ${saf.linhas.map(linha => `
                                            <li>
                                                ${escaparHtml(linha.nomeOriginal)} —
                                                calculado: ${linha.comprimentoCalculadoM.toFixed(1)} m
                                                ${linha.metrosDeclarados !== null ? `(declarado: ${linha.metrosDeclarados} m)` : ""}
                                            </li>
                                        `).join("")}
                                    </ul>
                                </li>
                            `).join("")}
                        </ul>
                    `;
                }

                if (totalContexto > 0) {
                    conteudoImportar.innerHTML += `
                        <p>${totalContexto} elemento(s) de contexto (casas, cercas, ruas etc — só o que está
                        visível no arquivo) serão adicionados ao mapa para ajudar a situar a propriedade.</p>
                    `;
                }
            }

            if (analise.avisos.length > 0) {
                conteudoImportar.innerHTML += `
                    <p><strong>Avisos:</strong></p>
                    <ul class="lista-avisos-saf">${analise.avisos.map(a => `<li>${escaparHtml(a)}</li>`).join("")}</ul>
                `;
            }

            dialogoImportar.showModal();
        });

        this.querySelector('[data-acao="cancelar-importacao-saf"]').addEventListener("click", () => {
            dialogoImportar.close();
        });

        botaoConfirmarImportacao.addEventListener("click", async () => {
            if (!this._analiseSafPendente) return;
            await importarParaProjeto(
                this.projetoId,
                this._analiseSafPendente.safsEncontradas,
                this._analiseSafPendente.elementosContexto
            );
            this._analiseSafPendente = null;
            dialogoImportar.close();
            await this.recarregarTudo();
        });

        this._wireEditorSaf();
    }

    /**
     * Matriz com todas as linhas de um SAF de uma vez, alinhadas por posição
     * geográfica real (ver docs/especificacao.md secao 14.5a) — uma linha
     * dividida em partes (ex: "Linha 3 Norte"/"Linha 3 Sul") aparece como uma
     * única fileira da matriz, com o vão real entre as partes em branco.
     */
    _wireEditorSaf() {
        const dialogoPlanta = this.querySelector(".dialogo-planta-metro");
        const tituloPlanta = this.querySelector(".planta-metro-titulo");
        const listaPlantasMetro = this.querySelector(".lista-plantas-metro");
        const formularioPlanta = this.querySelector(".formulario-planta");
        const listaSugestoesEspecies = this.querySelector("#sugestoes-especies");
        this._especiesDoCatalogo = [];

        // Recarregado a cada abertura do diálogo: a biblioteca é global e pode
        // ter mudado desde a última vez (editada em outra tela).
        const carregarSugestoesEspecies = async () => {
            this._especiesDoCatalogo = await plantaTerraDB.listarEspecies();
            listaSugestoesEspecies.innerHTML = this._especiesDoCatalogo
                .map(e => `<option value="${escaparHtml(e.nome_popular)}">${escaparHtml(e.nome_cientifico ?? "")}</option>`)
                .join("");
        };

        this.querySelector('[data-acao="fechar-planta-metro"]').addEventListener("click", () => dialogoPlanta.close());

        const campoDataPlantio = formularioPlanta.querySelector('[name="data_plantio"]');
        campoDataPlantio.addEventListener("input", () => {
            const digitos = campoDataPlantio.value.replace(/\D/g, "").slice(0, 8);
            if (digitos.length > 4) {
                campoDataPlantio.value = `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
            } else if (digitos.length > 2) {
                campoDataPlantio.value = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
            } else {
                campoDataPlantio.value = digitos;
            }
        });

        formularioPlanta.addEventListener("submit", async evento => {
            evento.preventDefault();
            const dados = new FormData(formularioPlanta);
            const dataPlantioTexto = dados.get("data_plantio").trim();
            let dataPlantio = null;
            if (dataPlantioTexto) {
                dataPlantio = parsearDataBr(dataPlantioTexto);
                if (dataPlantio === null) {
                    alert("Data de plantio inválida. Use o formato dd/mm/aaaa.");
                    return;
                }
            }

            // Nome igual (sem caixa/acento) a uma espécie da biblioteca vincula
            // ao catálogo; qualquer outro texto continua valendo como texto livre.
            const especieDigitada = dados.get("especie").trim();
            const chaveDigitada = normalizarNome(especieDigitada);
            const especieDoCatalogo = this._especiesDoCatalogo.find(e => normalizarNome(e.nome_popular) === chaveDigitada);

            await plantaTerraDB.criarPlanta({
                linhaId: this._linhaAtualParaPlanta.id,
                indiceMetro: this._metroEmEdicao,
                especie: especieDigitada,
                especieId: especieDoCatalogo?.id ?? null,
                quantidade: dados.get("quantidade") ? Number(dados.get("quantidade")) : null,
                observacao: dados.get("observacao").trim() || null,
                dataPlantio
            });

            formularioPlanta.reset();
            await this._recarregarAposMudarPlantas();
            this._abrirDialogoMetro(this._linhaAtualParaPlanta, this._metroEmEdicao);
        });

        this._abrirDialogoMetro = (linha, indiceMetro, coordenada) => {
            this._linhaAtualParaPlanta = linha;
            this._metroEmEdicao = indiceMetro;
            if (coordenada) {
                this._coordenadaMetroAtual = coordenada;
            }
            this.mapaElemento.destacarSegmentoAtivo(this._coordenadaMetroAtual);

            const plantasDoMetro = (this._plantasPorLinhaEmEdicao.get(linha.id) ?? [])
                .filter(p => p.indice_metro === indiceMetro);

            const rotuloLinha = linha.numero_linha !== null ? `Linha ${linha.numero_linha}` : linha.nome_original;
            // Com mais de um SAF no projeto, "Linha 1" sozinho é ambíguo (modo Andar mistura todos).
            const safDaLinha = this.safsComLinhas.find(({ saf }) => saf.id === linha.saf_id)?.saf;
            const prefixoSaf = this.safsComLinhas.length > 1 && safDaLinha ? `${safDaLinha.nome} · ` : "";
            tituloPlanta.textContent = `${prefixoSaf}${rotuloLinha} — metro ${indiceMetro}`;
            listaPlantasMetro.innerHTML = plantasDoMetro.length === 0
                ? `<li class="lista-vazia">Nenhuma planta cadastrada neste metro ainda.</li>`
                : plantasDoMetro.map(planta => `
                    <li class="item-planta" data-id="${planta.id}">
                        <span>
                            <strong>${escaparHtml(planta.especie)}</strong>
                            ${planta.quantidade ? ` (x${planta.quantidade})` : ""}
                            ${planta.observacao ? ` — ${escaparHtml(planta.observacao)}` : ""}
                            ${planta.data_plantio ? ` — plantado em ${formatarDataSimples(planta.data_plantio)}` : ""}
                        </span>
                        <button type="button" class="botao-excluir" data-acao="remover-planta" aria-label="Remover">🗑</button>
                    </li>
                `).join("");

            listaPlantasMetro.querySelectorAll('[data-acao="remover-planta"]').forEach(botao => {
                botao.addEventListener("click", async () => {
                    const id = botao.closest(".item-planta").dataset.id;
                    await plantaTerraDB.removerPlanta(id);
                    await this._recarregarAposMudarPlantas();
                    this._abrirDialogoMetro(linha, indiceMetro);
                });
            });

            formularioPlanta.reset();
            carregarSugestoesEspecies();
            dialogoPlanta.showModal();
        };
    }
}

customElements.define("painel-projeto", PainelProjeto);
