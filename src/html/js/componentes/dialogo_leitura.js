import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import "./campo_coordenada.js";

/**
 * <dialogo-leitura>: diálogo "Nova leitura" de uma estação de nível
 * (docs/especificacao.md secao 4). Não conhece banco nem o GPS.
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em dialogo_leitura.html);
 * estado reativo: { semCoordenada }.
 *
 * Entrada:  capturador (ver <campo-coordenada>), abrir(), fechar()
 * Eventos:  "leitura-criada"  detail { coordenada:{lat,lon,precisao}, alturaMira, ehPontoAmarracao }
 */
export class DialogoLeitura extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./dialogo_leitura.html", shadowDom: false }, import.meta.url);
    }

    connectedCallback() {
        if (!this.state) this.state = { semCoordenada: true };
    }

    onLoad() {
        super.onLoad();
        this._dialogo = this.querySelector("dialog");
        this._formulario = this.querySelector("form");
        this._campoCoordenada = this.querySelector("campo-coordenada");
        this._campoCoordenada.capturador = this._capturador;
        this._campoCoordenada.addEventListener("coordenada-capturada", () => {
            this.state = { semCoordenada: false };
        });
    }

    set capturador(funcao) {
        this._capturador = funcao;
        if (this._campoCoordenada) this._campoCoordenada.capturador = funcao;
    }

    async abrir() {
        await this.whenLoaded();
        this._formulario.reset();
        this._campoCoordenada.limpar();
        this.state = { semCoordenada: true };
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
        this.dispatchEvent(new CustomEvent("leitura-criada", {
            detail: {
                coordenada,
                alturaMira: Number(dados.get("altura_mira")),
                ehPontoAmarracao: dados.get("eh_ponto_amarracao") === "on"
            }
        }));
    }
}

customElements.define("dialogo-leitura", DialogoLeitura);
