import { escaparHtml, formatarDataSimples, parsearDataBr } from "./util_dom.js";
import { normalizarNome } from "../dominio/biblioteca_plantas.js";

let proximoId = 0;

/**
 * <dialogo-planta-metro>: diálogo das plantas de um metro de uma linha de
 * plantio (docs/especificacao.md secao 14.6) — lista o que já está plantado e
 * deixa adicionar/remover. Não conhece banco nem mapa: recebe dados, devolve eventos.
 *
 * Entrada:
 *   especies = [{ id, nome_popular, nome_cientifico }]  sugestões da biblioteca (opcional)
 *   abrir({ titulo, plantas })   abre (ou, se já aberto, só atualiza título e lista)
 *   fechar()
 *   aberto                       leitura
 *
 * Eventos (CustomEvent):
 *   "planta-adicionada"  detail { especie, especieId|null, quantidade|null, observacao|null, dataPlantio|null }
 *                        especieId só vem preenchido se o nome digitado (sem caixa/acento) é de uma espécie da biblioteca
 *   "planta-removida"    detail { id }
 */
export class DialogoPlantaMetro extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this._especies = [];

        const idLista = `sugestoes-especies-${proximoId++}`;
        this.innerHTML = `
            <dialog class="dialogo-planta-metro">
                <h2 class="planta-metro-titulo"></h2>
                <ul class="lista-plantas-metro"></ul>
                <form class="formulario-planta">
                    <label>Espécie / nome da planta
                        <input type="text" name="especie" required maxlength="80" list="${idLista}" autocomplete="off" />
                        <datalist id="${idLista}"></datalist>
                    </label>
                    <label>Quantidade (opcional)
                        <input type="number" name="quantidade" min="1" step="1" />
                    </label>
                    <label>Observação (opcional)
                        <input type="text" name="observacao" maxlength="200" />
                    </label>
                    <label>Data de plantio (opcional)
                        <input type="text" name="data_plantio" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" />
                    </label>
                    <div class="acoes-formulario">
                        <button type="submit" class="botao-primario">Adicionar planta</button>
                        <button type="button" data-acao="fechar-planta-metro">Fechar</button>
                    </div>
                </form>
            </dialog>
        `;
        this._dialogo = this.querySelector("dialog");
        this._titulo = this.querySelector(".planta-metro-titulo");
        this._lista = this.querySelector(".lista-plantas-metro");
        this._formulario = this.querySelector(".formulario-planta");
        this._sugestoes = this.querySelector("datalist");

        this.querySelector('[data-acao="fechar-planta-metro"]').addEventListener("click", () => this.fechar());

        const campoData = this._formulario.querySelector('[name="data_plantio"]');
        campoData.addEventListener("input", () => {
            const digitos = campoData.value.replace(/\D/g, "").slice(0, 8);
            if (digitos.length > 4) {
                campoData.value = `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
            } else if (digitos.length > 2) {
                campoData.value = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
            } else {
                campoData.value = digitos;
            }
        });

        this._formulario.addEventListener("submit", evento => {
            evento.preventDefault();
            const dados = new FormData(this._formulario);
            const dataTexto = dados.get("data_plantio").trim();
            let dataPlantio = null;
            if (dataTexto) {
                dataPlantio = parsearDataBr(dataTexto);
                if (dataPlantio === null) {
                    alert("Data de plantio inválida. Use o formato dd/mm/aaaa.");
                    return;
                }
            }

            // Nome igual (sem caixa/acento) a uma espécie da biblioteca vincula
            // ao catálogo; qualquer outro texto continua valendo como texto livre.
            const especie = dados.get("especie").trim();
            const chave = normalizarNome(especie);
            const doCatalogo = this._especies.find(e => normalizarNome(e.nome_popular) === chave);

            this._formulario.reset();
            this.dispatchEvent(new CustomEvent("planta-adicionada", {
                detail: {
                    especie,
                    especieId: doCatalogo?.id ?? null,
                    quantidade: dados.get("quantidade") ? Number(dados.get("quantidade")) : null,
                    observacao: dados.get("observacao").trim() || null,
                    dataPlantio
                }
            }));
        });

        this._lista.addEventListener("click", evento => {
            const botao = evento.target.closest('[data-acao="remover-planta"]');
            if (!botao) return;
            this.dispatchEvent(new CustomEvent("planta-removida", { detail: { id: botao.closest(".item-planta").dataset.id } }));
        });
    }

    get aberto() { return this._dialogo?.open ?? false; }

    set especies(lista) {
        this.connectedCallback();
        this._especies = lista ?? [];
        this._sugestoes.innerHTML = this._especies
            .map(e => `<option value="${escaparHtml(e.nome_popular)}">${escaparHtml(e.nome_cientifico ?? "")}</option>`)
            .join("");
    }

    abrir({ titulo, plantas }) {
        this.connectedCallback();
        this._titulo.textContent = titulo;
        this._lista.innerHTML = plantas.length === 0
            ? `<li class="lista-vazia">Nenhuma planta cadastrada neste metro ainda.</li>`
            : plantas.map(planta => `
                <li class="item-planta" data-id="${planta.id}">
                    <span>
                        <strong>${escaparHtml(planta.especie)}</strong>
                        ${planta.quantidade ? ` (x${planta.quantidade})` : ""}
                        ${planta.observacao ? ` — ${escaparHtml(planta.observacao)}` : ""}
                        ${planta.data_plantio ? ` — plantado em ${formatarDataSimples(planta.data_plantio)}` : ""}
                    </span>
                    <button type="button" class="botao-excluir" data-acao="remover-planta" aria-label="Remover">🗑</button>
                </li>
            `).join("");
        if (!this._dialogo.open) {
            this._formulario.reset();
            this._dialogo.showModal();
        }
    }

    fechar() {
        this._dialogo?.close();
    }
}

customElements.define("dialogo-planta-metro", DialogoPlantaMetro);
