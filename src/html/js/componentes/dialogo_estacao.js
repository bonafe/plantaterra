import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import "./campo_coordenada.js";

/**
 * <dialogo-estacao>: diálogo "Nova estação de nível" (docs/especificacao.md
 * secao 4). Não conhece banco nem o GPS: recebe a função de captura e devolve um evento.
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em dialogo_estacao.html);
 * estado reativo: { estacoesParaAmarrar, semAmarracao, semCoordenada }.
 *
 * Entrada:
 *   capturador                       async () => coordenada | null (ver <campo-coordenada>)
 *   abrir({ estacoesParaAmarrar })   [{ id, nome }] das estações que já têm ponto de amarração
 *   fechar()
 * Eventos:
 *   "estacao-criada"  detail { nome, coordenada:{lat,lon,precisao}, alturaInstrumento, amarradaAEstacaoId|null }
 */
export class DialogoEstacao extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./dialogo_estacao.html", shadowDom: false }, import.meta.url);
    }

    connectedCallback() {
        if (!this.state) this.state = { estacoesParaAmarrar: [], semAmarracao: true, semCoordenada: true };
    }

    onLoad() {
        super.onLoad();
        this._dialogo = this.querySelector("dialog");
        this._formulario = this.querySelector("form");
        this._campoCoordenada = this.querySelector("campo-coordenada");
        this._campoCoordenada.capturador = this._capturador;
        this._campoCoordenada.addEventListener("coordenada-capturada", () => {
            this.state = { ...this.state, semCoordenada: false };
        });
    }

    set capturador(funcao) {
        this._capturador = funcao;
        if (this._campoCoordenada) this._campoCoordenada.capturador = funcao;
    }

    async abrir({ estacoesParaAmarrar = [] } = {}) {
        await this.whenLoaded();
        this._formulario.reset();
        this._campoCoordenada.limpar();
        this.state = { estacoesParaAmarrar, semAmarracao: estacoesParaAmarrar.length === 0, semCoordenada: true };
        this._dialogo.showModal();
    }

    fechar() {
        this._dialogo?.close();
    }

    aoEnviar(evento) {
        evento.preventDefault();
        const coordenada = this._campoCoordenada.valor;
        if (!coordenada) return;
        const dados = new FormData(this._formulario);
        this.dispatchEvent(new CustomEvent("estacao-criada", {
            detail: {
                nome: dados.get("nome").trim(),
                coordenada,
                alturaInstrumento: Number(dados.get("altura_instrumento")),
                amarradaAEstacaoId: dados.get("amarrada_a") || null
            }
        }));
    }
}

customElements.define("dialogo-estacao", DialogoEstacao);
