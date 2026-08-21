import { plantaTerraDB } from "../db/plantaterra_db.js";
import { exportarProjeto } from "../db/exportador_projeto.js";
import { exportarGeoJSON, exportarKML, exportarKMZ } from "../db/exportador_geoespacial.js";
import { CaptadorTrilha } from "../gps/captador_trilha.js";
import {
    calcularAltitudeLeitura,
    calcularOffsetPorAmarracao,
    recalcularLeiturasDaEstacao,
    consolidarPontosDoProjeto
} from "../dominio/nivelamento.js";
import { gerarCurvasDeNivel } from "../geo/curvas_de_nivel.js";
import { areaPoligonoMetros2 } from "../geo/geodesia.js";
import { dividirEmMetros } from "../geo/segmentador_linha.js";
import { calcularMatrizSaf } from "../geo/matriz_saf.js";
import { agruparPlantasPorMetro } from "../dominio/saf.js";
import { analisarArquivoParaImportacao, importarParaProjeto } from "../kml/importador_saf.js";
import { escaparHtml, formatarMetros, formatarArea, formatarData, formatarDataSimples, parsearDataBr } from "./util_dom.js";
import "./mapa_projeto.js";
import "./captura_gps.js";

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

                <mapa-projeto class="mapa"></mapa-projeto>

                <div class="painel-inferior">
                    <div class="secoes-padrao">
                        <section class="secao-perimetro">
                            <div class="secao-cabecalho">
                                <h2>Perímetro</h2>
                                <span class="area-perimetro"></span>
                            </div>
                            <button type="button" data-acao="mapear-perimetro" class="botao-secundario botao-largo">
                                Mapear perímetro caminhando
                            </button>
                            <button type="button" data-acao="abrir-historico-perimetro" class="botao-secundario botao-largo">
                                Histórico de rodadas
                            </button>
                        </section>

                        <section class="secao-estacoes">
                            <div class="secao-cabecalho">
                                <h2>Estações de nível</h2>
                                <button type="button" data-acao="nova-estacao" class="botao-primario">+ Estação</button>
                            </div>
                            <ul class="lista-estacoes"></ul>
                        </section>

                        <section class="secao-curvas">
                            <button type="button" data-acao="gerar-curvas" class="botao-secundario botao-largo">
                                Gerar curvas de nível
                            </button>
                        </section>

                        <section class="secao-saf">
                            <div class="secao-cabecalho">
                                <h2>Sistemas Agroflorestais (SAF)</h2>
                                <label class="botao-secundario botao-arquivo">
                                    Importar KMZ/KML
                                    <input type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" data-acao="importar-arquivo-saf" hidden />
                                </label>
                            </div>
                            <p class="saf-resumo-total"></p>
                            <ul class="lista-safs"></ul>
                        </section>
                    </div>

                    <section class="secao-editor-saf" hidden>
                        <div class="secao-cabecalho">
                            <button type="button" data-acao="fechar-editor-saf" class="botao-icone" aria-label="Voltar">←</button>
                            <h2 class="editor-saf-titulo"></h2>
                        </div>
                        <p class="editor-saf-info"></p>
                        <div class="matriz-saf-wrapper">
                            <div class="matriz-saf"></div>
                        </div>
                    </section>
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
                            <input type="text" name="especie" required maxlength="80" />
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
        this._wirePerimetro();
        this._wireEstacoes();
        this._wireCurvasDeNivel();
        this._wireSaf();

        await this.recarregarTudo();
    }

    async recarregarTudo() {
        const [trilhaAtiva, estacoesComLeituras, safsComLinhas, elementosContexto] = await Promise.all([
            plantaTerraDB.trilhaAtiva(this.projetoId),
            plantaTerraDB.listarTodasLeiturasDoProjeto(this.projetoId),
            plantaTerraDB.listarTodasLinhasDoProjeto(this.projetoId),
            plantaTerraDB.listarElementosContexto(this.projetoId)
        ]);

        this.trilhaAtiva = trilhaAtiva;
        this.estacoesComLeituras = estacoesComLeituras;
        this.safsComLinhas = safsComLinhas;

        this.mapaElemento.definirElementosContexto(elementosContexto);
        this.mapaElemento.definirPoligonoPerimetro(trilhaAtiva?.poligono ?? null);
        this.mapaElemento.definirEstacoesELeituras(estacoesComLeituras);
        this.mapaElemento.definirLinhasSaf(safsComLinhas);
        this.mapaElemento.ajustarZoomParaConteudo();

        const areaElemento = this.querySelector(".area-perimetro");
        areaElemento.textContent = trilhaAtiva?.poligono?.length >= 3
            ? formatarArea(areaPoligonoMetros2(trilhaAtiva.poligono))
            : "ainda não mapeado";

        this._renderizarListaEstacoes();
        this._renderizarListaSafs();
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

            if (resultado.poligono.length < 3) {
                alert("Poucos pontos capturados para formar um perímetro. Tente novamente.");
                return;
            }

            if (!resultado.fechamentoOk) {
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
                pontos_brutos: resultado.pontos_brutos,
                poligono: resultado.poligono,
                ativo: true,
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
            }
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

        lista.innerHTML = trilhas.map(trilha => `
            <li class="item-historico-perimetro" data-id="${trilha.id}">
                <span>
                    <strong>${formatarData(trilha.criado_em)}</strong>${trilha.ativo ? " — ativo" : ""}
                    <br>
                    ${trilha.poligono?.length >= 3 ? formatarArea(areaPoligonoMetros2(trilha.poligono)) : "polígono incompleto"}
                </span>
                <span class="acoes-item-historico">
                    ${trilha.ativo ? "" : `<button type="button" class="botao-secundario" data-acao="usar-rodada-perimetro">Usar esta</button>`}
                    <button type="button" class="botao-excluir" data-acao="excluir-rodada-perimetro" aria-label="Excluir">🗑</button>
                </span>
            </li>
        `).join("");
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

    _renderizarListaSafs() {
        const listaElemento = this.querySelector(".lista-safs");
        const resumoElemento = this.querySelector(".saf-resumo-total");

        if (this.safsComLinhas.length === 0) {
            listaElemento.innerHTML = `<li class="lista-vazia">Nenhum SAF importado ainda.</li>`;
            resumoElemento.textContent = "";
            return;
        }

        const totalLinhas = this.safsComLinhas.reduce((soma, { linhas }) => soma + linhas.length, 0);
        const totalMetros = this.safsComLinhas.reduce(
            (soma, { linhas }) => soma + linhas.reduce((s, l) => s + l.comprimento_calculado_m, 0),
            0
        );
        resumoElemento.textContent =
            `${this.safsComLinhas.length} SAF(s) · ${totalLinhas} linha(s) no total · ${totalMetros.toFixed(0)} m no total`;

        listaElemento.innerHTML = this.safsComLinhas.map(({ saf, linhas }) => {
            const comprimentoTotal = linhas.reduce((soma, l) => soma + l.comprimento_calculado_m, 0);
            return `
                <li class="item-saf" data-id="${saf.id}">
                    <button type="button" class="item-saf-botao" data-acao="abrir-saf">
                        <strong>${escaparHtml(saf.nome)}</strong>
                        <span>${linhas.length} linha(s) · ${comprimentoTotal.toFixed(0)} m</span>
                    </button>
                </li>
            `;
        }).join("");

        listaElemento.querySelectorAll('[data-acao="abrir-saf"]').forEach(botao => {
            botao.addEventListener("click", () => {
                const safId = botao.closest(".item-saf").dataset.id;
                const { saf } = this.safsComLinhas.find(item => item.saf.id === safId);
                this._abrirEditorSaf(saf);
            });
        });
    }

    /**
     * Matriz com todas as linhas de um SAF de uma vez, alinhadas por posição
     * geográfica real (ver docs/especificacao.md secao 14.5a) — uma linha
     * dividida em partes (ex: "Linha 3 Norte"/"Linha 3 Sul") aparece como uma
     * única fileira da matriz, com o vão real entre as partes em branco.
     */
    _wireEditorSaf() {
        const secaoNormal = this.querySelector(".secoes-padrao");
        const secaoEditor = this.querySelector(".secao-editor-saf");
        const tituloEditor = this.querySelector(".editor-saf-titulo");
        const infoEditor = this.querySelector(".editor-saf-info");
        const matrizElemento = this.querySelector(".matriz-saf");

        const dialogoPlanta = this.querySelector(".dialogo-planta-metro");
        const tituloPlanta = this.querySelector(".planta-metro-titulo");
        const listaPlantasMetro = this.querySelector(".lista-plantas-metro");
        const formularioPlanta = this.querySelector(".formulario-planta");

        this.querySelector('[data-acao="fechar-editor-saf"]').addEventListener("click", () => {
            secaoEditor.hidden = true;
            secaoNormal.hidden = false;
            this.mapaElemento.limparLinhasDestacadas();
            this._safEmEdicao = null;
        });

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

            await plantaTerraDB.criarPlanta({
                linhaId: this._linhaAtualParaPlanta.id,
                indiceMetro: this._metroEmEdicao,
                especie: dados.get("especie").trim(),
                quantidade: dados.get("quantidade") ? Number(dados.get("quantidade")) : null,
                observacao: dados.get("observacao").trim() || null,
                dataPlantio
            });

            formularioPlanta.reset();
            await this._recarregarEditorSaf();
            this._abrirDialogoMetro(this._linhaAtualParaPlanta, this._metroEmEdicao);
        });

        this._abrirEditorSaf = async saf => {
            this._safEmEdicao = saf;
            secaoNormal.hidden = true;
            secaoEditor.hidden = false;
            await this._recarregarEditorSaf();
        };

        this._recarregarEditorSaf = async () => {
            const saf = this._safEmEdicao;
            const linhas = await plantaTerraDB.listarLinhasDaSaf(saf.id);
            const plantasPorLinha = await Promise.all(linhas.map(l => plantaTerraDB.listarPlantasDaLinha(l.id)));

            this._linhasDoSafEmEdicaoPorId = new Map(linhas.map(l => [l.id, l]));
            this._plantasPorLinhaEmEdicao = new Map(linhas.map((l, indice) => [l.id, plantasPorLinha[indice]]));

            const matriz = calcularMatrizSaf(linhas);
            const totalPlantas = plantasPorLinha.reduce((soma, lista) => soma + lista.length, 0);

            tituloEditor.textContent = saf.nome;
            infoEditor.textContent =
                `${linhas.length} linha(s) · ${matriz.linhasLogicas.length} fileira(s) na matriz · ` +
                `${totalPlantas} planta(s) cadastrada(s)`;

            this._renderizarMatriz(matriz, matrizElemento);

            const partesParaMapa = linhas.map(linha => {
                const plantasPorMetro = agruparPlantasPorMetro(this._plantasPorLinhaEmEdicao.get(linha.id));
                const { segmentos } = dividirEmMetros(linha.geometria);
                const pontosPlantados = [...plantasPorMetro.entries()]
                    .map(([indiceMetro, plantasDoMetro]) => ({
                        indiceMetro,
                        coordenada: segmentos[indiceMetro]?.meio,
                        plantas: plantasDoMetro
                    }))
                    .filter(ponto => ponto.coordenada);
                return { linha, pontosPlantados };
            });
            this.mapaElemento.destacarLinhas(partesParaMapa);
        };

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
            tituloPlanta.textContent = `${rotuloLinha} — metro ${indiceMetro}`;
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
                    await this._recarregarEditorSaf();
                    this._abrirDialogoMetro(linha, indiceMetro);
                });
            });

            formularioPlanta.reset();
            dialogoPlanta.showModal();
        };
    }

    _renderizarMatriz(matriz, matrizElemento) {
        const numeroColunas = Math.max(matriz.colunaMaximaGlobal - matriz.colunaMinimaGlobal + 1, 1);
        matrizElemento.style.gridTemplateColumns = `minmax(110px, max-content) repeat(${numeroColunas}, 36px)`;
        matrizElemento.style.gridTemplateRows = `repeat(${matriz.linhasLogicas.length}, 36px)`;

        const coordenadaPorCelula = new Map();
        let html = "";

        matriz.linhasLogicas.forEach((linhaLogica, indiceLinha) => {
            const linha = indiceLinha + 1;
            html += `<div class="matriz-saf-rotulo" style="grid-row:${linha};grid-column:1">${escaparHtml(linhaLogica.nomeExibicao)}</div>`;

            for (const quadrado of linhaLogica.quadrados) {
                const plantasDoMetro = (this._plantasPorLinhaEmEdicao.get(quadrado.linhaId) ?? [])
                    .filter(p => p.indice_metro === quadrado.indiceMetro);
                const coluna = quadrado.colunaGlobal - matriz.colunaMinimaGlobal + 2;
                const classe = plantasDoMetro.length > 0 ? "quadrado-metro quadrado-metro-plantado" : "quadrado-metro";
                const chaveCelula = `${quadrado.linhaId}|${quadrado.indiceMetro}`;
                coordenadaPorCelula.set(chaveCelula, quadrado.coordenada);

                html += `
                    <button type="button" class="${classe}" style="grid-row:${linha};grid-column:${coluna}"
                        data-linha-id="${quadrado.linhaId}" data-indice-metro="${quadrado.indiceMetro}"
                        title="${escaparHtml(linhaLogica.nomeExibicao)} · metro ${quadrado.indiceMetro}">
                        ${plantasDoMetro.length > 0 ? `<span class="quadrado-metro-contagem">${plantasDoMetro.length}</span>` : ""}
                    </button>
                `;
            }
        });

        matrizElemento.innerHTML = html;

        matrizElemento.querySelectorAll(".quadrado-metro").forEach(botao => {
            botao.addEventListener("click", () => {
                const linha = this._linhasDoSafEmEdicaoPorId.get(botao.dataset.linhaId);
                const indiceMetro = Number(botao.dataset.indiceMetro);
                const coordenada = coordenadaPorCelula.get(`${botao.dataset.linhaId}|${indiceMetro}`);
                this._abrirDialogoMetro(linha, indiceMetro, coordenada);
            });
        });
    }
}

customElements.define("painel-projeto", PainelProjeto);
