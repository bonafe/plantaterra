import { escaparHtml, formatarArea, formatarData } from "./util_dom.js";
import { areaPoligonoMetros2 } from "../geo/geodesia.js";

/**
 * <dialogo-historico-perimetro>: histórico de rodadas de captura do perímetro
 * (docs/especificacao.md secao 6) — renomear, mostrar/esconder no mapa, definir
 * como principal, editar pontos, exportar KML e excluir. Não conhece banco nem
 * mapa: quem usa grava e atualiza `rodadas` depois de cada evento.
 *
 * Entrada:  rodadas = trilhas do projeto (a ordem é do componente: mais recente primeiro),
 *           abrir(), fechar(), aberto
 * Eventos (detail sempre com o id da rodada):
 *   "definir-principal" {id}   "excluir-rodada" {id} (já confirmado)   "editar-pontos" {id}
 *   "exportar-kml" {id}        "renomear-rodada" {id, nome|null}       "visibilidade-alterada" {id, visivel}
 */
export class DialogoHistoricoPerimetro extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this._rodadas = [];
        this._editandoNomeId = null;

        this.innerHTML = `
            <dialog class="dialogo-historico-perimetro">
                <h2>Histórico de rodadas do perímetro</h2>
                <ul class="lista-historico-perimetro"></ul>
                <div class="acoes-formulario">
                    <button type="button" data-acao="fechar-historico-perimetro">Fechar</button>
                </div>
            </dialog>
        `;
        this._dialogo = this.querySelector("dialog");
        this._lista = this.querySelector(".lista-historico-perimetro");

        this.querySelector('[data-acao="fechar-historico-perimetro"]').addEventListener("click", () => this.fechar());

        const avisar = (tipo, detail) => this.dispatchEvent(new CustomEvent(tipo, { detail }));

        this._lista.addEventListener("click", evento => {
            const botao = evento.target.closest("button[data-acao]");
            if (!botao) return;
            const id = botao.closest(".item-historico-perimetro").dataset.id;

            switch (botao.dataset.acao) {
                case "usar-rodada-perimetro":
                    avisar("definir-principal", { id });
                    break;
                case "excluir-rodada-perimetro":
                    if (confirm("Excluir esta rodada de captura do perímetro? Essa ação não pode ser desfeita.")) {
                        avisar("excluir-rodada", { id });
                    }
                    break;
                case "editar-pontos-perimetro":
                    avisar("editar-pontos", { id });
                    break;
                case "exportar-kml-rodada":
                    avisar("exportar-kml", { id });
                    break;
                case "renomear-rodada":
                    this._editandoNomeId = id;
                    this._desenhar();
                    break;
            }
        });

        this._lista.addEventListener("change", evento => {
            const checkbox = evento.target.closest('[data-acao="alternar-visivel-rodada"]');
            if (!checkbox) return;
            avisar("visibilidade-alterada", {
                id: checkbox.closest(".item-historico-perimetro").dataset.id,
                visivel: checkbox.checked
            });
        });
    }

    get aberto() { return this._dialogo?.open ?? false; }

    set rodadas(lista) {
        this.connectedCallback();
        this._rodadas = [...lista].sort((a, b) => b.criado_em - a.criado_em);
        this._desenhar();
    }

    abrir() {
        this.connectedCallback();
        this._dialogo.showModal();
    }

    fechar() {
        this._dialogo?.close();
    }

    _desenhar() {
        const lista = this._lista;
        if (this._rodadas.length === 0) {
            lista.innerHTML = `<li class="lista-vazia">Nenhuma rodada capturada ainda.</li>`;
            return;
        }

        lista.innerHTML = this._rodadas.map(trilha => {
            const nome = trilha.nome || `Perímetro ${formatarData(trilha.criado_em)}`;
            const visivel = trilha.visivel !== false;
            const emEdicao = this._editandoNomeId === trilha.id;

            return `
            <li class="item-historico-perimetro" data-id="${trilha.id}">
                <span>
                    ${emEdicao
                        ? `<input type="text" class="input-nome-rodada" value="${escaparHtml(nome)}" maxlength="60" />`
                        : `<strong>${escaparHtml(nome)}</strong>
                           <button type="button" class="botao-icone-inline" data-acao="renomear-rodada" aria-label="Renomear">✏️</button>`
                    }
                    ${trilha.ativo ? " — principal" : ""}
                    <br>
                    ${trilha.poligono?.length >= 3 ? formatarArea(areaPoligonoMetros2(trilha.poligono)) : "polígono incompleto"}
                    · ${formatarData(trilha.criado_em)}
                    <label class="campo-checkbox">
                        <input type="checkbox" data-acao="alternar-visivel-rodada" ${visivel ? "checked" : ""} />
                        Visível no mapa
                    </label>
                </span>
                <span class="acoes-item-historico">
                    <button type="button" class="botao-secundario" data-acao="editar-pontos-perimetro">Editar pontos</button>
                    ${trilha.poligono?.length >= 3
                        ? `<button type="button" class="botao-secundario" data-acao="exportar-kml-rodada">Exportar KML</button>`
                        : ""}
                    ${trilha.ativo ? "" : `<button type="button" class="botao-secundario" data-acao="usar-rodada-perimetro">Definir como principal</button>`}
                    <button type="button" class="botao-excluir" data-acao="excluir-rodada-perimetro" aria-label="Excluir">🗑</button>
                </span>
            </li>
        `;
        }).join("");

        if (this._editandoNomeId) this._ligarEdicaoDoNome();
    }

    _ligarEdicaoDoNome() {
        const input = this._lista.querySelector(".input-nome-rodada");
        if (!input) return;
        input.focus();
        input.select();

        const confirmar = () => {
            const id = this._editandoNomeId;
            this._editandoNomeId = null;
            this.dispatchEvent(new CustomEvent("renomear-rodada", { detail: { id, nome: input.value.trim() || null } }));
        };

        input.addEventListener("blur", confirmar, { once: true });
        input.addEventListener("keydown", evento => {
            if (evento.key === "Enter") {
                input.blur();
            } else if (evento.key === "Escape") {
                input.removeEventListener("blur", confirmar);
                this._editandoNomeId = null;
                this._desenhar();
            }
        });
    }
}

customElements.define("dialogo-historico-perimetro", DialogoHistoricoPerimetro);
