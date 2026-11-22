import { escaparHtml } from "./util_dom.js";

/**
 * <dialogo-importar-saf>: pré-visualização do que um arquivo KML/KMZ trouxe
 * (SAFs com linhas, elementos de contexto e avisos — docs/especificacao.md
 * secoes 14.3 e 14.8) antes de gravar. Não lê arquivo nem grava: quem usa
 * analisa o arquivo e entrega o resultado.
 *
 * Entrada:  abrir({ safsEncontradas, elementosContexto, avisos })  resultado de analisarArquivoParaImportacao
 *           fechar(), aberto
 * Eventos:  "importacao-confirmada"  detail { safsEncontradas, elementosContexto }
 */
export class DialogoImportarSaf extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this._analise = null;

        this.innerHTML = `
            <dialog class="dialogo-importar-saf">
                <h2>Importar SAF/linhas de plantio</h2>
                <div class="importar-saf-conteudo"></div>
                <div class="acoes-formulario">
                    <button type="button" data-acao="confirmar-importacao-saf" class="botao-primario">Importar</button>
                    <button type="button" data-acao="cancelar-importacao-saf">Cancelar</button>
                </div>
            </dialog>
        `;
        this._dialogo = this.querySelector("dialog");
        this._conteudo = this.querySelector(".importar-saf-conteudo");
        this._botaoConfirmar = this.querySelector('[data-acao="confirmar-importacao-saf"]');

        this.querySelector('[data-acao="cancelar-importacao-saf"]').addEventListener("click", () => this.fechar());

        this._botaoConfirmar.addEventListener("click", () => {
            if (!this._analise) return;
            const { safsEncontradas, elementosContexto } = this._analise;
            this.dispatchEvent(new CustomEvent("importacao-confirmada", { detail: { safsEncontradas, elementosContexto } }));
        });
    }

    get aberto() { return this._dialogo?.open ?? false; }

    abrir(analise) {
        this.connectedCallback();
        this._analise = analise;

        const safsComLinhas = analise.safsEncontradas.filter(saf => saf.linhas.length > 0);
        const totalLinhas = safsComLinhas.reduce((soma, saf) => soma + saf.linhas.length, 0);
        const totalContexto = analise.elementosContexto.length;

        let html = "";
        if (safsComLinhas.length === 0 && totalContexto === 0) {
            html = `<p>Nenhum SAF com linhas nem elemento de contexto foi reconhecido neste arquivo.</p>`;
            this._botaoConfirmar.hidden = true;
        } else {
            this._botaoConfirmar.hidden = false;

            if (safsComLinhas.length > 0) {
                html += `
                    <p>${safsComLinhas.length} SAF(s), ${totalLinhas} linha(s) reconhecida(s):</p>
                    <ul class="lista-preview-saf">
                        ${safsComLinhas.map(saf => `
                            <li>
                                <strong>${escaparHtml(saf.nomeOriginal)}</strong>
                                <ul>
                                    ${saf.linhas.map(linha => `
                                        <li>
                                            ${escaparHtml(linha.nomeOriginal)} —
                                            calculado: ${linha.comprimentoCalculadoM.toFixed(1)} m
                                            ${linha.metrosDeclarados !== null ? `(declarado: ${linha.metrosDeclarados} m)` : ""}
                                        </li>
                                    `).join("")}
                                </ul>
                            </li>
                        `).join("")}
                    </ul>
                `;
            }

            if (totalContexto > 0) {
                html += `
                    <p>${totalContexto} elemento(s) de contexto (casas, cercas, ruas etc — só o que está
                    visível no arquivo) serão adicionados ao mapa para ajudar a situar a propriedade.</p>
                `;
            }
        }

        if (analise.avisos.length > 0) {
            html += `
                <p><strong>Avisos:</strong></p>
                <ul class="lista-avisos-saf">${analise.avisos.map(a => `<li>${escaparHtml(a)}</li>`).join("")}</ul>
            `;
        }

        this._conteudo.innerHTML = html;
        this._dialogo.showModal();
    }

    fechar() {
        this._analise = null;
        this._dialogo?.close();
    }
}

customElements.define("dialogo-importar-saf", DialogoImportarSaf);
