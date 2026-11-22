/**
 * <campo-limpavel>: envolve um <input> de texto e mostra o botão "Limpar" enquanto houver texto.
 * Tocar nele esvazia o campo, dispara "input" (quem filtra a lista reage como se a pessoa tivesse
 * apagado tudo) e devolve o foco ao campo. Usar em toda busca/filtro por texto do app.
 *
 *   <campo-limpavel><input type="search" ...></campo-limpavel>
 *
 * Valor mudado por código (campo.value = ...) não dispara "input": quem faz isso deve disparar
 * `new Event("input", { bubbles: true })` para o botão acompanhar. O reset do formulário é tratado.
 */
export class CampoLimpavel extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this._campo = this.querySelector("input");
        if (!this._campo) return;

        this._botao = document.createElement("button");
        this._botao.type = "button";
        this._botao.className = "campo-limpavel-botao";
        this._botao.textContent = "Limpar";
        this._botao.setAttribute("aria-label", "Limpar o texto do campo");
        this.append(this._botao);

        const atualizar = () => { this._botao.hidden = !this._campo.value; };
        this._campo.addEventListener("input", atualizar);
        // O reset do formulário esvazia o campo sem disparar "input".
        this._campo.form?.addEventListener("reset", () => setTimeout(atualizar));
        this._botao.addEventListener("click", () => {
            this._campo.value = "";
            this._campo.dispatchEvent(new Event("input", { bubbles: true }));
            this._campo.focus();
        });
        atualizar();
    }
}

customElements.define("campo-limpavel", CampoLimpavel);
