import { descreverIdadePlantio, escaparHtml } from "./util_dom.js";

/**
 * <resumo-metro>: em tela pequena, a coluna ao lado do mapa com o que está plantado no metro tocado
 * (docs/especificacao.md secao 14.9). A coluna inteira é um botão. Só mostra e avisa.
 *
 * Entrada:  definir({ titulo, metro, plantas })  `plantas`: registros planta_linha daquele metro
 * Eventos:  "detalhe-solicitado"  a pessoa tocou: quer abrir a edição do metro
 */
export class ResumoMetro extends HTMLElement {

    connectedCallback() {
        if (this._botao) return;
        this.innerHTML = `<button type="button" class="resumo-metro-botao"></button>`;
        this._botao = this.querySelector("button");
        this._botao.addEventListener("click", () => this.dispatchEvent(new CustomEvent("detalhe-solicitado")));
    }

    definir({ titulo, metro, plantas }) {
        this.connectedCallback();
        const itens = plantas.map(planta => {
            const detalhes = [
                planta.quantidade ? `${planta.quantidade} planta(s)` : "",
                planta.sementes ? `${planta.sementes} semente(s)` : "",
                planta.data_plantio ? descreverIdadePlantio(planta.data_plantio) : "",
                planta.observacao ?? ""
            ].filter(Boolean).join(" · ");
            return `<span class="resumo-metro-planta"><strong>${escaparHtml(planta.especie)}</strong>` +
                (detalhes ? `<small>${escaparHtml(detalhes)}</small>` : "") + `</span>`;
        }).join("");

        this._botao.innerHTML = `
            <span class="resumo-metro-conteudo">
                <span class="resumo-metro-titulo"><strong>${escaparHtml(titulo)}</strong> metro ${metro}</span>
                ${itens || `<span class="resumo-metro-vazio">Nenhuma planta.</span>`}
            </span>
            <span class="resumo-metro-acao">${plantas.length ? "Editar ›" : "+ Planta ›"}</span>`;
    }
}

customElements.define("resumo-metro", ResumoMetro);
