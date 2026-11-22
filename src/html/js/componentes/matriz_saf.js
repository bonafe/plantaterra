import { escaparHtml } from "./util_dom.js";

/**
 * <matriz-saf>: a matriz de fileiras de um SAF (docs/especificacao.md secao 14.5a)
 * — uma célula por metro de plantio, alinhadas pela posição geográfica real.
 * Só desenha e avisa; não conhece banco, mapa nem GPS.
 *
 * Entrada:
 *   definir({ matriz, plantasPorLinha })  matriz = resultado de calcularMatrizSaf;
 *                                         plantasPorLinha = Map(linhaId → plantas[])
 *   marcarProximos(chavesPerto, chaveMaisProximo)  destaca células (chave "linhaId|indiceMetro") e a coluna/fileira da mais próxima
 *   selecionar(chave)                     marca a célula tocada (fica até outra ser escolhida)
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
        // Linha 1 da grade = cabeçalho com os números de metro; coluna 1 = nome da fileira.
        this._grade.style.gridTemplateColumns = `max-content repeat(${numeroColunas}, var(--tam-celula, 36px))`;
        this._grade.style.gridTemplateRows = `var(--alt-cabecalho, 28px) repeat(${matriz.linhasLogicas.length}, var(--tam-celula, 36px))`;

        this._coordenadaPorChave = new Map();

        // Cabeçalho: a coluna é a distância em metros desde a ponta esquerda da matriz (as fileiras
        // são alinhadas pela posição geográfica real, §14.5a). Para uma fileira que começa na ponta,
        // é o mesmo número do "metro N" do diálogo; fileiras que começam adiante diferem pelo recuo.
        let html = `<div class="matriz-saf-canto" style="grid-row:1;grid-column:1">metro</div>`;
        for (let i = 0; i < numeroColunas; i++) {
            html += `<div class="matriz-saf-cabecalho" style="grid-row:1;grid-column:${i + 2}" data-coluna="${i}">${i}</div>`;
        }

        matriz.linhasLogicas.forEach((linhaLogica, indiceLinha) => {
            const linha = indiceLinha + 2;
            html += `<div class="matriz-saf-rotulo" style="grid-row:${linha};grid-column:1" data-fileira="${indiceLinha}">${escaparHtml(linhaLogica.nomeExibicao)}</div>`;

            for (const quadrado of linhaLogica.quadrados) {
                const plantasDoMetro = (plantasPorLinha.get(quadrado.linhaId) ?? [])
                    .filter(p => p.indice_metro === quadrado.indiceMetro);
                const coluna = quadrado.colunaGlobal - matriz.colunaMinimaGlobal;
                const classe = plantasDoMetro.length > 0 ? "quadrado-metro quadrado-metro-plantado" : "quadrado-metro";
                this._coordenadaPorChave.set(`${quadrado.linhaId}|${quadrado.indiceMetro}`, quadrado.coordenada);

                html += `
                    <button type="button" class="${classe}" style="grid-row:${linha};grid-column:${coluna + 2}"
                        data-linha-id="${quadrado.linhaId}" data-indice-metro="${quadrado.indiceMetro}"
                        data-coluna="${coluna}" data-fileira="${indiceLinha}"
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
        if (this._chaveSelecionada) this.selecionar(this._chaveSelecionada);
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

        // Acende também o número da coluna e o nome da fileira: a pessoa lê "linha X, metro Y" sem contar células.
        const gps = chaveMaisProximo ? this._celulas?.get(chaveMaisProximo) : null;
        this._grade?.querySelectorAll(".matriz-saf-cabecalho").forEach(c =>
            c.classList.toggle("matriz-saf-ativo", !!gps && c.dataset.coluna === gps.dataset.coluna));
        this._grade?.querySelectorAll(".matriz-saf-rotulo").forEach(r =>
            r.classList.toggle("matriz-saf-ativo", !!gps && r.dataset.fileira === gps.dataset.fileira));
    }

    selecionar(chave) {
        this._chaveSelecionada = chave;
        this._celulas?.forEach((celula, c) => celula.classList.toggle("quadrado-metro-selecionado", c === chave));
    }

    rolarPara(chave) {
        const celula = this._celulas?.get(chave);
        if (!celula || !this._wrapper.offsetParent) return; // escondida (ex: modo foco): sem medidas, não rola
        const c = celula.getBoundingClientRect();
        const w = this._wrapper.getBoundingClientRect();
        // O nome da fileira (esquerda) e o cabeçalho (topo) ficam fixos por cima: centraliza na área que sobra.
        const rotulo = this._grade.querySelector(".matriz-saf-rotulo")?.getBoundingClientRect().width ?? 0;
        const cabecalho = this._grade.querySelector(".matriz-saf-cabecalho")?.getBoundingClientRect().height ?? 0;
        this._wrapper.scrollTo({
            left: this._wrapper.scrollLeft + (c.left - w.left) - rotulo - (w.width - rotulo) / 2 + c.width / 2,
            top: this._wrapper.scrollTop + (c.top - w.top) - cabecalho - (w.height - cabecalho) / 2 + c.height / 2,
            behavior: "smooth"
        });
    }
}

customElements.define("matriz-saf", MatrizSaf);
