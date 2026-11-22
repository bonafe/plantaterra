import { escaparHtml } from "./util_dom.js";
import "./campo_coordenada.js";

/**
 * <dialogo-estacao>: diálogo "Nova estação de nível" (docs/especificacao.md
 * secao 4). Não conhece banco nem o GPS: recebe a função de captura e devolve um evento.
 *
 * Entrada:
 *   capturador                       async () => coordenada | null (ver <campo-coordenada>)
 *   abrir({ estacoesParaAmarrar })   [{ id, nome }] das estações que já têm ponto de amarração
 *   fechar()
 * Eventos:
 *   "estacao-criada"  detail { nome, coordenada:{lat,lon,precisao}, alturaInstrumento, amarradaAEstacaoId|null }
 */
export class DialogoEstacao extends HTMLElement {

    set capturador(funcao) {
        this.connectedCallback();
        this._campoCoordenada.capturador = funcao;
    }

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.innerHTML = `
            <dialog class="dialogo-estacao">
                <form class="formulario-estacao">
                    <h2>Nova estação de nível</h2>
                    <campo-coordenada></campo-coordenada>
                    <label>Nome da estação
                        <input type="text" name="nome" required maxlength="60" />
                    </label>
                    <label>Altura do instrumento (m)
                        <input type="number" name="altura_instrumento" step="0.001" min="0" required />
                    </label>
                    <label class="campo-amarracao" hidden>Amarrar a
                        <select name="amarrada_a"></select>
                    </label>
                    <div class="acoes-formulario">
                        <button type="submit" class="botao-primario" disabled>Salvar estação</button>
                        <button type="button" data-acao="cancelar-estacao">Cancelar</button>
                    </div>
                </form>
            </dialog>
        `;
        this._dialogo = this.querySelector("dialog");
        this._formulario = this.querySelector("form");
        this._campoCoordenada = this.querySelector("campo-coordenada");
        this._botaoSalvar = this._formulario.querySelector('button[type="submit"]');
        this._campoAmarracao = this._formulario.querySelector(".campo-amarracao");
        this._selectAmarracao = this._campoAmarracao.querySelector("select");

        this._campoCoordenada.addEventListener("coordenada-capturada", () => { this._botaoSalvar.disabled = false; });
        this.querySelector('[data-acao="cancelar-estacao"]').addEventListener("click", () => this.fechar());

        this._formulario.addEventListener("submit", evento => {
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
        });
    }

    abrir({ estacoesParaAmarrar = [] } = {}) {
        this.connectedCallback();
        this._formulario.reset();
        this._campoCoordenada.limpar();
        this._botaoSalvar.disabled = true;

        if (estacoesParaAmarrar.length > 0) {
            this._selectAmarracao.innerHTML =
                `<option value="">Nenhuma (esta será uma referência independente)</option>` +
                estacoesParaAmarrar.map(e => `<option value="${e.id}">${escaparHtml(e.nome)}</option>`).join("");
            this._campoAmarracao.hidden = false;
        } else {
            this._campoAmarracao.hidden = true;
        }
        this._dialogo.showModal();
    }

    fechar() {
        this._dialogo?.close();
    }
}

customElements.define("dialogo-estacao", DialogoEstacao);
