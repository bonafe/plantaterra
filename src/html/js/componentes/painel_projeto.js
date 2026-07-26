import { plantaTerraDB } from "../db/plantaterra_db.js";
import { exportarProjeto } from "../db/exportador_projeto.js";
import { CaptadorTrilha } from "../gps/captador_trilha.js";
import {
    calcularAltitudeLeitura,
    calcularOffsetPorAmarracao,
    recalcularLeiturasDaEstacao,
    consolidarPontosDoProjeto
} from "../dominio/nivelamento.js";
import { gerarCurvasDeNivel } from "../geo/curvas_de_nivel.js";
import { areaPoligonoMetros2 } from "../geo/geodesia.js";
import { escaparHtml, formatarMetros, formatarArea } from "./util_dom.js";
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
                    <button type="button" data-acao="exportar" class="botao-icone" aria-label="Exportar projeto">⭳</button>
                </header>

                <mapa-projeto class="mapa"></mapa-projeto>

                <div class="painel-inferior">
                    <section class="secao-perimetro">
                        <div class="secao-cabecalho">
                            <h2>Perímetro</h2>
                            <span class="area-perimetro"></span>
                        </div>
                        <button type="button" data-acao="mapear-perimetro" class="botao-secundario botao-largo">
                            Mapear perímetro caminhando
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
            </div>
        `;

        this.mapaElemento = this.querySelector("mapa-projeto");
        this.capturaGps = this.querySelector("captura-gps");

        this._wireExportar();
        this._wirePerimetro();
        this._wireEstacoes();
        this._wireCurvasDeNivel();

        await this.recarregarTudo();
    }

    async recarregarTudo() {
        const [trilhaAtiva, estacoesComLeituras] = await Promise.all([
            plantaTerraDB.trilhaAtiva(this.projetoId),
            plantaTerraDB.listarTodasLeiturasDoProjeto(this.projetoId)
        ]);

        this.trilhaAtiva = trilhaAtiva;
        this.estacoesComLeituras = estacoesComLeituras;

        this.mapaElemento.definirPoligonoPerimetro(trilhaAtiva?.poligono ?? null);
        this.mapaElemento.definirEstacoesELeituras(estacoesComLeituras);
        this.mapaElemento.ajustarZoomParaConteudo();

        const areaElemento = this.querySelector(".area-perimetro");
        areaElemento.textContent = trilhaAtiva?.poligono?.length >= 3
            ? formatarArea(areaPoligonoMetros2(trilhaAtiva.poligono))
            : "ainda não mapeado";

        this._renderizarListaEstacoes();
    }

    // ---------------- Exportar ----------------

    _wireExportar() {
        this.querySelector('[data-acao="exportar"]').addEventListener("click", () => {
            exportarProjeto(this.projetoId);
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
}

customElements.define("painel-projeto", PainelProjeto);
