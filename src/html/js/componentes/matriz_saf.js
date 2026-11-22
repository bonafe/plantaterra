import { escaparHtml } from "./util_dom.js";

/**
 * <matriz-saf>: a matriz de fileiras de um SAF (docs/especificacao.md secao 14.5a)
 * — uma célula por metro de plantio, alinhadas pela posição geográfica real.
 * Só desenha e avisa; não conhece banco, mapa nem GPS.
 *
 * Entrada:
 *   definir({ matriz, plantasPorLinha })  matriz = resultado de calcularMatrizSaf;
 *                                         plantasPorLinha = Map(linhaId → plantas[])
 *   marcarProximos(chavesPerto, chaveMaisProximo)  destaca células (chave "linhaId|indiceMetro")
 *   rolarPara(chave)                      centraliza a célula (rolagem suave)
 *   modoAndar = true|false                células maiores para tocar andando
 *
 * Eventos (CustomEvent):
 *   "metro-tocado"       detail { linhaId, indiceMetro, coordenada }
 *   "controle-assumido"  a pessoa tocou/rolou a matriz (o GPS-guia deve pausar)
 */
export class MatrizSaf extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.innerHTML = `<div class="matriz-saf-wrapper"><div class="matriz-saf"></div></div>`;
        this._wrapper = this.querySelector(".matriz-saf-wrapper");
        this._grade = this.querySelector(".matriz-saf");
        this._celulas = new Map();
        this._coordenadaPorChave = new Map();

        ["pointerdown", "wheel", "touchstart"].forEach(tipo =>
            this._wrapper.addEventListener(tipo, () => this.dispatchEvent(new CustomEvent("controle-assumido")), { passive: true }));

        this._grade.addEventListener("click", evento => {
            const botao = evento.target.closest(".quadrado-metro");
            if (!botao) return;
            const indiceMetro = Number(botao.dataset.indiceMetro);
            this.dispatchEvent(new CustomEvent("metro-tocado", {
                detail: {
                    linhaId: botao.dataset.linhaId,
                    indiceMetro,
                    coordenada: this._coordenadaPorChave.get(`${botao.dataset.linhaId}|${indiceMetro}`)
                }
            }));
        });
    }

    set modoAndar(ativo) {
        this.classList.toggle("modo-andar", ativo);
    }

    definir({ matriz, plantasPorLinha }) {
        this.connectedCallback();
        const numeroColunas = Math.max(matriz.colunaMaximaGlobal - matriz.colunaMinimaGlobal + 1, 1);
        this._grade.style.gridTemplateColumns = `minmax(110px, max-content) repeat(${numeroColunas}, var(--tam-celula, 36px))`;
        this._grade.style.gridTemplateRows = `repeat(${matriz.linhasLogicas.length}, var(--tam-celula, 36px))`;

        this._coordenadaPorChave = new Map();
        let html = "";

        matriz.linhasLogicas.forEach((linhaLogica, indiceLinha) => {
            const linha = indiceLinha + 1;
            html += `<div class="matriz-saf-rotulo" style="grid-row:${linha};grid-column:1">${escaparHtml(linhaLogica.nomeExibicao)}</div>`;

            for (const quadrado of linhaLogica.quadrados) {
                const plantasDoMetro = (plantasPorLinha.get(quadrado.linhaId) ?? [])
                    .filter(p => p.indice_metro === quadrado.indiceMetro);
                const coluna = quadrado.colunaGlobal - matriz.colunaMinimaGlobal + 2;
                const classe = plantasDoMetro.length > 0 ? "quadrado-metro quadrado-metro-plantado" : "quadrado-metro";
                this._coordenadaPorChave.set(`${quadrado.linhaId}|${quadrado.indiceMetro}`, quadrado.coordenada);

                html += `
                    <button type="button" class="${classe}" style="grid-row:${linha};grid-column:${coluna}"
                        data-linha-id="${quadrado.linhaId}" data-indice-metro="${quadrado.indiceMetro}"
                        title="${escaparHtml(linhaLogica.nomeExibicao)} · metro ${quadrado.indiceMetro}">
                        ${plantasDoMetro.length > 0 ? `<span class="quadrado-metro-contagem">${plantasDoMetro.length}</span>` : ""}
                    </button>
                `;
            }
        });

        this._grade.innerHTML = html;

        this._celulas = new Map();
        this._grade.querySelectorAll(".quadrado-metro").forEach(botao => {
            this._celulas.set(`${botao.dataset.linhaId}|${botao.dataset.indiceMetro}`, botao);
        });
    }

    limpar() {
        this.connectedCallback();
        this._grade.innerHTML = "";
        this._celulas = new Map();
    }

    marcarProximos(chavesPerto = [], chaveMaisProximo = null) {
        const perto = new Set(chavesPerto);
        this._celulas?.forEach((celula, chave) => {
            celula.classList.toggle("quadrado-metro-perto", perto.has(chave));
            celula.classList.toggle("quadrado-metro-gps", chave === chaveMaisProximo);
        });
    }

    rolarPara(chave) {
        const celula = this._celulas?.get(chave);
        if (!celula) return;
        const c = celula.getBoundingClientRect();
        const w = this._wrapper.getBoundingClientRect();
        this._wrapper.scrollTo({
            left: this._wrapper.scrollLeft + (c.left - w.left) - w.width / 2 + c.width / 2,
            top: this._wrapper.scrollTop + (c.top - w.top) - w.height / 2 + c.height / 2,
            behavior: "smooth"
        });
    }
}

customElements.define("matriz-saf", MatrizSaf);
