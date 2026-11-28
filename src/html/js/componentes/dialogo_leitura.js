import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import "./campo_coordenada.js";
import { cmParaMetros, metrosParaCm } from "../dominio/nivelamento.js";

/**
 * <dialogo-leitura>: diálogo de criar ou editar uma leitura de uma estação de nível
 * (docs/especificacao.md secao 4). Não conhece banco nem o GPS.
 * A pessoa digita a altura em cm; os eventos saem em metros.
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em dialogo_leitura.html);
 * estado reativo: { titulo, rotuloSalvar, semCoordenada }.
 *
 * Entrada:  capturador (ver <campo-coordenada>), abrir() para nova, abrir({ leitura }) para editar, fechar()
 * Eventos:  "leitura-criada"   detail { coordenada:{lat,lon,precisao}, alturaMira, ehPontoAmarracao }
 *           "leitura-editada"  detail { id, coordenada, alturaMira, ehPontoAmarracao }
 */
export class DialogoLeitura extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./dialogo_leitura.html", shadowDom: false }, import.meta.url);
    }

    connectedCallback() {
        if (!this.state) this.state = DialogoLeitura._estado(null);
    }

    static _estado(leitura) {
        return {
            titulo: leitura ? "Editar leitura" : "Nova leitura",
            rotuloSalvar: leitura ? "Salvar alterações" : "Salvar leitura",
            semCoordenada: !leitura
        };
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

    async abrir({ leitura = null } = {}) {
        await this.whenLoaded();
        this._formulario.reset();
        this._idEmEdicao = leitura?.id ?? null;
        if (leitura) {
            this._campoCoordenada.definir(leitura.coordenada);
            this._formulario.elements.altura_mira.value = metrosParaCm(leitura.altura_mira);
            this._formulario.elements.eh_ponto_amarracao.checked = leitura.eh_ponto_amarracao;
        } else {
            this._campoCoordenada.limpar();
        }
        this.state = DialogoLeitura._estado(leitura);
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
        const comuns = {
            coordenada,
            alturaMira: cmParaMetros(Number(dados.get("altura_mira"))),
            ehPontoAmarracao: dados.get("eh_ponto_amarracao") === "on"
        };
        this.dispatchEvent(this._idEmEdicao
            ? new CustomEvent("leitura-editada", { detail: { id: this._idEmEdicao, ...comuns } })
            : new CustomEvent("leitura-criada", { detail: comuns }));
    }
}

customElements.define("dialogo-leitura", DialogoLeitura);
