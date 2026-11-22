/**
 * <campo-coordenada>: linha "status + Capturar posição GPS" de um formulário.
 * Não captura nada sozinho: quem usa informa uma função `capturador`
 * (async () => ({ lat, lon, precisao }) | null), por exemplo `<captura-gps>.abrir()`.
 *
 * Entrada:  capturador, valor (leitura), limpar()
 * Eventos:  "coordenada-capturada" detail { lat, lon, precisao }
 */
export class CampoCoordenada extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this.valor = null;

        this.innerHTML = `
            <p class="campo-coordenada-status">Nenhuma coordenada capturada ainda.</p>
            <button type="button" class="botao-secundario" data-acao="capturar-coordenada">Capturar posição GPS</button>
        `;
        this._status = this.querySelector(".campo-coordenada-status");

        this.querySelector("button").addEventListener("click", async () => {
            if (!this.capturador) return;
            this._status.textContent = "Capturando…";
            const resultado = await this.capturador();
            if (!resultado) {
                this._status.textContent = "Não foi possível obter uma posição GPS. Tente novamente.";
                return;
            }
            this.valor = { lat: resultado.lat, lon: resultado.lon, precisao: resultado.precisao };
            this._status.textContent =
                `Capturado: ${resultado.lat.toFixed(6)}, ${resultado.lon.toFixed(6)} (±${resultado.precisao.toFixed(1)} m)`;
            this.dispatchEvent(new CustomEvent("coordenada-capturada", { detail: this.valor }));
        });
    }

    limpar() {
        this.connectedCallback();
        this.valor = null;
        this._status.textContent = "Nenhuma coordenada capturada ainda.";
    }
}

customElements.define("campo-coordenada", CampoCoordenada);
