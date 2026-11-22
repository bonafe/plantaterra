import { escaparHtml } from "./util_dom.js";
import { segmentarDestaque } from "../dominio/biblioteca_plantas.js";

/** Texto escapado, com `<mark>` onde aparece a consulta (busca sem caixa/acento). */
function comDestaque(texto, consulta) {
    return segmentarDestaque(texto, consulta)
        .map(({ t, m }) => (m ? `<mark class="destaque-busca">${escaparHtml(t)}</mark>` : escaparHtml(t))).join("");
}

/**
 * <card-planta>: card de uma planta/espécie — espaço para foto (ou ilustração; sem imagem, um 🌱),
 * nome popular, nome científico embaixo, linhas de detalhe e botões de ação. Reaproveitado no painel
 * de plantas de um metro (SAF) e na biblioteca (docs/especificacao.md §14.11, §15.1).
 *
 * Entrada: propriedade (ou atributo JSON) `dados` =
 *   { nome, cientifico?, linhas?: [texto], foto?: url, acoes?: [{ acao, icone, rotulo }], clicavel?: boolean, destaque?: texto buscado }
 * Com `clicavel`, tocar no card (ou Enter/Espaço) emite a ação "abrir" — dá para listar sem botões e deixar
 * editar/remover para um detalhe.
 * Evento: "acao-card" (borbulha) detail { acao } — quem usa descobre o card por `evento.target`.
 *
 * Adapta-se à largura do PRÓPRIO card (container query em estilo.css), não da tela: cabe em
 * coluna estreita de celular e ganha foto/fontes maiores em colunas largas de tela grande.
 */
export class CardPlanta extends HTMLElement {

    static observedAttributes = ["dados"];

    get dados() {
        try {
            return JSON.parse(this.getAttribute("dados")) ?? {};
        } catch {
            return {};
        }
    }

    set dados(valor) {
        this.setAttribute("dados", JSON.stringify(valor ?? {}));
    }

    connectedCallback() {
        if (!this._ouvindo) {
            this._ouvindo = true;
            this.addEventListener("keydown", evento => {
                if ((evento.key === "Enter" || evento.key === " ") && evento.target.matches(".card-planta-conteudo[role=button]")) {
                    evento.preventDefault();
                    evento.target.click();
                }
            });
            this.addEventListener("click", evento => {
                const botao = evento.target.closest("[data-acao-card]");
                if (!botao) return;
                this.dispatchEvent(new CustomEvent("acao-card", { bubbles: true, detail: { acao: botao.dataset.acaoCard } }));
            });
        }
        this._renderizar();
    }

    attributeChangedCallback() {
        if (this.isConnected) this._renderizar();
    }

    _renderizar() {
        const { nome = "", cientifico = "", linhas = [], foto = null, acoes = [], clicavel = false, destaque = "" } = this.dados;
        this.innerHTML = `
            <article class="card-planta-conteudo"${clicavel ? ' role="button" tabindex="0" data-acao-card="abrir"' : ""}>
                <span class="card-planta-foto" aria-hidden="true">${foto ? `<img src="${escaparHtml(foto)}" alt="" loading="lazy" />` : "🌱"}</span>
                <div class="card-planta-corpo">
                    <strong class="card-planta-nome">${comDestaque(nome, destaque)}</strong>
                    ${cientifico ? `<em class="card-planta-cientifico">${comDestaque(cientifico, destaque)}</em>` : ""}
                    ${linhas.filter(Boolean).map(l => `<span class="card-planta-linha">${comDestaque(l, destaque)}</span>`).join("")}
                </div>
                ${acoes.length ? `<div class="card-planta-acoes">${acoes.map(a =>
                    `<button type="button" class="botao-excluir" data-acao-card="${escaparHtml(a.acao)}" aria-label="${escaparHtml(a.rotulo ?? a.acao)}">${escaparHtml(a.icone ?? "")}</button>`
                ).join("")}</div>` : ""}
            </article>`;
    }
}

customElements.define("card-planta", CardPlanta);
