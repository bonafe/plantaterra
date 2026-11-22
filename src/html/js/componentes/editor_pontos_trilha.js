import { formatarData } from "./util_dom.js";

/**
 * <editor-pontos-trilha>: painel do editor de pontos brutos de uma rodada de
 * captura (docs/especificacao.md secao 6). Guarda a lista de pontos em edição,
 * o ponto selecionado e se houve alteração; quem desenha os pontos no mapa, valida
 * o polígono e grava no banco é quem usa — o componente não conhece mapa nem banco.
 *
 * Entrada:
 *   abrir({ pontos })        mostra o painel com uma cópia dos pontos [{lat, lon, timestamp, precisao}]
 *   selecionarPonto(indice)  seleciona (ou null) — o mapa avisa o toque, quem usa repassa
 *   fechar()                 esconde e descarta o estado (sem confirmar)
 *   aberto                   leitura
 *
 * Eventos (CustomEvent):
 *   "pontos-mudaram"      detail { pontos, indiceSelecionado, tMin, tMax, primeira } — redesenhar no mapa
 *   "salvar-solicitado"   detail { pontos } — validar e gravar; depois chamar fechar()
 *   "fechado"             o painel foi fechado (pelo botão, já confirmado, ou por fechar())
 */
export class EditorPontosTrilha extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.hidden = true;
        this.classList.add("editor-pontos-trilha");
        this.innerHTML = `
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
        `;
        this._status = this.querySelector(".editar-pontos-status");
        this._detalhe = this.querySelector(".editar-pontos-detalhe");
        this._botaoExcluir = this.querySelector('[data-acao="excluir-ponto-selecionado"]');
        this._estado = null;

        this._botaoExcluir.addEventListener("click", () => {
            const estado = this._estado;
            if (!estado || estado.selecionado === null) return;
            estado.pontos.splice(estado.selecionado, 1);
            estado.selecionado = null;
            estado.alterado = true;
            this._atualizar();
        });

        this.querySelector('[data-acao="fechar-editar-pontos"]').addEventListener("click", () => {
            if (this._estado?.alterado && !confirm("Descartar as alterações feitas nos pontos desta rodada?")) return;
            this.fechar();
        });

        this.querySelector('[data-acao="salvar-edicao-pontos"]').addEventListener("click", () => {
            if (!this._estado) return;
            this.dispatchEvent(new CustomEvent("salvar-solicitado", { detail: { pontos: this._estado.pontos.slice() } }));
        });
    }

    get aberto() { return this._estado !== null && this._estado !== undefined; }

    abrir({ pontos }) {
        this.connectedCallback();
        this._estado = {
            pontos: pontos.slice(),
            tMin: pontos[0]?.timestamp,
            tMax: pontos[pontos.length - 1]?.timestamp,
            selecionado: null,
            alterado: false
        };
        this.hidden = false;
        this._atualizar({ primeira: true });
    }

    selecionarPonto(indice) {
        if (!this._estado) return;
        this._estado.selecionado = indice;
        this._atualizar();
    }

    fechar() {
        if (!this._estado) return;
        this._estado = null;
        this.hidden = true;
        this.dispatchEvent(new CustomEvent("fechado"));
    }

    _atualizar({ primeira = false } = {}) {
        const { pontos, selecionado, tMin, tMax } = this._estado;
        this._status.textContent = `${pontos.length} pontos — toque em um ponto no mapa para selecioná-lo.`;

        const ponto = selecionado !== null ? pontos[selecionado] : null;
        this._detalhe.hidden = !ponto;
        this._botaoExcluir.hidden = !ponto;
        if (ponto) {
            const precisao = ponto.precisao != null ? `${ponto.precisao.toFixed(0)} m` : "desconhecida";
            this._detalhe.textContent = `Ponto selecionado: ${formatarData(ponto.timestamp)} — precisão ${precisao}`;
        }

        this.dispatchEvent(new CustomEvent("pontos-mudaram", {
            detail: { pontos, indiceSelecionado: selecionado, tMin, tMax, primeira }
        }));
    }
}

customElements.define("editor-pontos-trilha", EditorPontosTrilha);
