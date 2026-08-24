import { markupPainelPix, montarPainelPix } from "../apoio_pix.js";

/**
 * <tela-apoiar>: painel de apoio via Pix (ver docs/especificacao.md
 * secao 11.1). A lógica do painel em si vive em `js/apoio_pix.js`,
 * compartilhada com a landing page na raiz do repositório.
 */
export class TelaApoiar extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <div class="tela-apoiar">
                <header class="cabecalho-app cabecalho-projeto">
                    <button type="button" class="botao-voltar" data-acao="voltar" aria-label="Voltar">←</button>
                    <h1>Apoiar o PlantaTerra</h1>
                </header>

                <div class="painel-apoiar">
                    <p>
                        O PlantaTerra é gratuito e de código aberto, e vai continuar assim.
                        Se ele te ajudou a mapear sua propriedade, uma contribuição via Pix
                        ajuda a manter o domínio, o tempo de desenvolvimento e novas
                        funcionalidades — mas nunca é necessária pra usar o app.
                    </p>
                    ${markupPainelPix()}
                </div>
            </div>
        `;

        this.querySelector('[data-acao="voltar"]').addEventListener("click", () => history.back());

        montarPainelPix(this.querySelector(".painel-apoiar"));
    }
}

customElements.define("tela-apoiar", TelaApoiar);
