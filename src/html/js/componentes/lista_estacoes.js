import { escaparHtml, formatarMetros } from "./util_dom.js";

/**
 * <lista-estacoes>: estações de nível e suas leituras, cada uma num bloco
 * expansível com o botão "+ Leitura nesta estação".
 *
 * Entrada:  estacoes = [{ estacao, leituras }]
 * Eventos:  "nova-leitura-solicitada"  detail { estacaoId }
 */
export class ListaEstacoes extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this.innerHTML = `<ul class="lista-estacoes"></ul>`;
        this._lista = this.querySelector("ul");

        this._lista.addEventListener("click", evento => {
            const botao = evento.target.closest('[data-acao="nova-leitura"]');
            if (!botao) return;
            this.dispatchEvent(new CustomEvent("nova-leitura-solicitada", {
                detail: { estacaoId: botao.closest(".item-estacao").dataset.id }
            }));
        });
    }

    set estacoes(lista) {
        this.connectedCallback();
        if (lista.length === 0) {
            this._lista.innerHTML = `<li class="lista-vazia">Nenhuma estação ainda.</li>`;
            return;
        }

        this._lista.innerHTML = lista.map(({ estacao, leituras }) => `
            <li class="item-estacao" data-id="${estacao.id}">
                <details>
                    <summary>
                        <strong>${escaparHtml(estacao.nome)}</strong>
                        <span>altura instr.: ${formatarMetros(estacao.altura_instrumento)}</span>
                        <span>offset: ${formatarMetros(estacao.offset_altitude)}</span>
                    </summary>
                    <ul class="lista-leituras">
                        ${leituras.map(leitura => `
                            <li class="item-leitura">
                                mira: ${formatarMetros(leitura.altura_mira)}
                                → altitude: ${formatarMetros(leitura.altitude_relativa, 2)}
                                ${leitura.eh_ponto_amarracao ? " 🔗 amarração" : ""}
                            </li>
                        `).join("")}
                    </ul>
                    <button type="button" class="botao-secundario" data-acao="nova-leitura">+ Leitura nesta estação</button>
                </details>
            </li>
        `).join("");
    }
}

customElements.define("lista-estacoes", ListaEstacoes);
