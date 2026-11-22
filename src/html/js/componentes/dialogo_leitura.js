import "./campo_coordenada.js";

/**
 * <dialogo-leitura>: diálogo "Nova leitura" de uma estação de nível
 * (docs/especificacao.md secao 4). Não conhece banco nem o GPS.
 *
 * Entrada:  capturador (ver <campo-coordenada>), abrir(), fechar()
 * Eventos:  "leitura-criada"  detail { coordenada:{lat,lon,precisao}, alturaMira, ehPontoAmarracao }
 */
export class DialogoLeitura extends HTMLElement {

    set capturador(funcao) {
        this.connectedCallback();
        this._campoCoordenada.capturador = funcao;
    }

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.innerHTML = `
            <dialog class="dialogo-leitura">
                <form class="formulario-leitura">
                    <h2>Nova leitura</h2>
                    <campo-coordenada></campo-coordenada>
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
        `;
        this._dialogo = this.querySelector("dialog");
        this._formulario = this.querySelector("form");
        this._campoCoordenada = this.querySelector("campo-coordenada");
        this._botaoSalvar = this._formulario.querySelector('button[type="submit"]');

        this._campoCoordenada.addEventListener("coordenada-capturada", () => { this._botaoSalvar.disabled = false; });
        this.querySelector('[data-acao="cancelar-leitura"]').addEventListener("click", () => this.fechar());

        this._formulario.addEventListener("submit", evento => {
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
        });
    }

    abrir() {
        this.connectedCallback();
        this._formulario.reset();
        this._campoCoordenada.limpar();
        this._botaoSalvar.disabled = true;
        this._dialogo.showModal();
    }

    fechar() {
        this._dialogo?.close();
    }
}

customElements.define("dialogo-leitura", DialogoLeitura);
