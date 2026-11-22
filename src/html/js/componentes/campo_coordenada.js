import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";

const STATUS_INICIAL = "Nenhuma coordenada capturada ainda.";

/**
 * <campo-coordenada>: linha "status + Capturar posição GPS" de um formulário.
 * Não captura nada sozinho: quem usa informa uma função `capturador`
 * (async () => ({ lat, lon, precisao }) | null), por exemplo `<captura-gps>.abrir()`.
 *
 * Feito sobre o ReactiveComponent do UltimaJS (vendor/ultima): o template está em
 * campo_coordenada.html e o estado `{ status, valor }` é reativo — mudar o estado
 * redesenha a tela. DOM normal (sem Shadow DOM) para valer o css/estilo.css do app.
 *
 * Entrada:  capturador, valor (leitura), limpar()
 * Eventos:  "coordenada-capturada" detail { lat, lon, precisao }
 */
export class CampoCoordenada extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./campo_coordenada.html", shadowDom: false }, import.meta.url);
    }

    connectedCallback() {
        // O estado não pode ser definido no construtor (criar o elemento por createElement não admite atributos).
        if (!this.state) this.state = { status: STATUS_INICIAL, valor: null };
    }

    get valor() {
        return this.state?.valor ?? null;
    }

    limpar() {
        this.state = { status: STATUS_INICIAL, valor: null };
    }

    async capturar() {
        if (!this.capturador) return;
        this.state = { ...this.state, status: "Capturando…" };

        const resultado = await this.capturador();
        if (!resultado) {
            this.state = { ...this.state, status: "Não foi possível obter uma posição GPS. Tente novamente." };
            return;
        }

        const valor = { lat: resultado.lat, lon: resultado.lon, precisao: resultado.precisao };
        this.state = {
            status: `Capturado: ${valor.lat.toFixed(6)}, ${valor.lon.toFixed(6)} (±${valor.precisao.toFixed(1)} m)`,
            valor
        };
        this.dispatchEvent(new CustomEvent("coordenada-capturada", { detail: valor }));
    }
}

customElements.define("campo-coordenada", CampoCoordenada);
