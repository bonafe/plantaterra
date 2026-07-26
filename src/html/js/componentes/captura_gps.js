import { CaptadorCoordenada } from "../gps/captador_coordenada.js";

const ROTULO_QUALIDADE = {
    boa: "Sinal bom",
    razoavel: "Sinal razoável",
    ruim: "Sinal fraco — aguardando melhora"
};

/**
 * <captura-gps>: diálogo modal que mostra o progresso da captura de uma
 * coordenada estabilizada (ver docs/especificacao.md secao 5) e permite
 * cancelar ou aceitar mesmo com baixa precisão.
 *
 * Uso: const resultado = await elemento.abrir();
 * resultado é null se cancelado, ou { lat, lon, precisao, ... } caso contrário.
 */
export class CapturaGps extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.innerHTML = `
            <dialog class="dialogo-captura-gps">
                <h2>Capturando posição GPS…</h2>
                <p class="captura-gps-qualidade">Aguardando sinal…</p>
                <p class="captura-gps-detalhe">Amostras aceitas: 0</p>
                <div class="captura-gps-acoes">
                    <button type="button" data-acao="aceitar" disabled>Aceitar mesmo assim</button>
                    <button type="button" data-acao="cancelar">Cancelar</button>
                </div>
            </dialog>
        `;

        this.dialogo = this.querySelector("dialog");
        this.elementoQualidade = this.querySelector(".captura-gps-qualidade");
        this.elementoDetalhe = this.querySelector(".captura-gps-detalhe");
        this.botaoAceitar = this.querySelector('[data-acao="aceitar"]');
        this.botaoCancelar = this.querySelector('[data-acao="cancelar"]');

        this.botaoCancelar.addEventListener("click", () => this.captador?.cancelar());
        this.botaoAceitar.addEventListener("click", () => this.captador?.aceitarMesmoAssim());
    }

    abrir(opcoes = {}) {
        this.captador = new CaptadorCoordenada(opcoes);

        this.elementoQualidade.textContent = "Aguardando sinal…";
        this.elementoDetalhe.textContent = "Amostras aceitas: 0";
        this.botaoAceitar.disabled = true;

        this.captador.addEventListener(CaptadorCoordenada.EVENTO_AMOSTRA, evento => {
            const { aceita, totalAceitas, qualidadeSinal, amostra } = evento.detail;
            this.elementoQualidade.textContent = ROTULO_QUALIDADE[qualidadeSinal];
            this.elementoDetalhe.textContent =
                `Amostras aceitas: ${totalAceitas} · precisão atual: ${amostra.precisao.toFixed(1)} m` +
                (aceita ? "" : " (descartada)");
            this.botaoAceitar.disabled = totalAceitas === 0;
        });

        this.dialogo.showModal();

        return this.captador.capturar().then(resultado => {
            this.dialogo.close();
            return resultado.lat === null ? null : resultado;
        });
    }
}

customElements.define("captura-gps", CapturaGps);
