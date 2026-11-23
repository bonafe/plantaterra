import { FILTROS_VAZIOS, NIVEIS_BIBLIOTECA, NOMES_MESES, REINOS_BIBLIOTECA, ROTULO_ESTRATO, ROTULO_LUZ, ROTULO_ORIGEM, contarCriterios, rotuloDaFuncao } from "../dominio/filtros_especies.js";
import { ESTADOS_BRASIL } from "../dominio/estados_brasil.js";
import { escaparHtml } from "./util_dom.js";

const maiuscula = t => t.replace(/^./, c => c.toUpperCase());

/**
 * <painel-filtros-especies>: painel (diálogo) com todos os filtros da biblioteca de plantas — forma de vida, altura,
 * função, estrato, origem, luz, floração, estado, família, com foto… Só desenha e avisa; quem filtra é o domínio
 * (`dominio/filtros_especies.js`) e quem guarda o estado é a tela.
 *
 * Entrada:
 *   definir(facetas)    opções das espécies COM FICHA, com contagem (resultado de `construirFacetas`); reconstrói o painel.
 *                       Nível, reino, "só com ficha" e "só com nome popular" valem para a biblioteca inteira (catálogo nacional)
 *   filtros = {…}       critérios marcados (formato de FILTROS_VAZIOS)
 *   contagem = n        resultados com os filtros de agora (texto do botão "Ver n plantas")
 *   abrir() / fechar()
 * Eventos (CustomEvent):
 *   "filtros-mudaram"   detail { filtros }   a cada alteração
 */
export class PainelFiltrosEspecies extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this._filtros = { ...FILTROS_VAZIOS };
        this.innerHTML = `<dialog class="painel-filtros" aria-label="Filtros"></dialog>`;
        this._dialogo = this.querySelector("dialog");
        this._dialogo.addEventListener("change", () => this._aoMudar());
        this._dialogo.addEventListener("input", evento => { if (evento.target.matches('input[type="number"]')) this._aoMudar(); });
        this._dialogo.addEventListener("click", evento => {
            const acao = evento.target.closest("[data-acao]")?.dataset.acao;
            if (acao === "fechar") this._dialogo.close();
            else if (acao === "limpar") { this._filtros = { ...FILTROS_VAZIOS }; this._aplicarNosControles(); this._emitir(); }
            else if (acao === "altura") {
                const [min, max] = evento.target.closest("[data-acao]").dataset.faixa.split(",").map(v => (v === "" ? null : Number(v)));
                this._filtros = { ...this._filtros, alturaMin: min, alturaMax: max };
                this._aplicarNosControles();
                this._emitir();
            }
        });
    }

    set filtros(valor) {
        this.connectedCallback();
        this._filtros = { ...FILTROS_VAZIOS, ...valor };
        this._aplicarNosControles();
    }

    set contagem(n) {
        this.connectedCallback();
        const botao = this._dialogo.querySelector('[data-acao="fechar"].filtros-ver');
        if (botao) botao.textContent = n === null ? "Ver resultados" : n === 1 ? "Ver 1 ficha" : `Ver ${n.toLocaleString("pt-BR")} fichas`;
    }

    abrir() { this.connectedCallback(); if (!this._dialogo.open) this._dialogo.showModal(); }
    fechar() { this._dialogo?.close(); }

    /** Constrói os controles a partir das opções que existem na biblioteca (só aparece o que dá resultado). */
    definir(facetas) {
        this.connectedCallback();
        const chips = (grupo, mapa, rotulo, ordem) => {
            const itens = [...mapa].sort(ordem ?? ((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "pt-BR")));
            return itens.length ? `<div class="chips-filtro">${itens.map(([valor, qtd]) => `
                <label class="chip-filtro"><input type="checkbox" data-grupo="${grupo}" value="${escaparHtml(String(valor))}" />
                    <span>${escaparHtml(rotulo(valor))} <small>${qtd}</small></span></label>`).join("")}</div>`
                : `<p class="filtro-vazio">Nenhuma espécie com essa informação ainda.</p>`;
        };
        const secao = (id, titulo, corpo, { aberta = false, nota = "" } = {}) => `
            <details class="secao-filtro" data-secao="${id}"${aberta ? " open" : ""}>
                <summary>${titulo} <span class="secao-marcados" data-marcados="${id}"></span></summary>${nota ? `<p class="filtro-nota">${nota}</p>` : ""}${corpo}
            </details>`;
        const meses = grupo => `<div class="chips-filtro">${NOMES_MESES.map((mes, i) => `
            <label class="chip-filtro chip-mes"><input type="checkbox" data-grupo="${grupo}" value="${i + 1}" /><span>${mes}</span></label>`).join("")}</div>`;
        const ordemFixa = lista => (a, b) => lista.indexOf(a[0]) - lista.indexOf(b[0]);
        const familias = [...facetas.familias].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
        const ufs = ESTADOS_BRASIL.filter(e => facetas.ufs.has(e.uf));

        this._dialogo.innerHTML = `
            <div class="filtros-cabecalho"><h2>Filtros</h2><button type="button" class="botao-link" data-acao="limpar">Limpar tudo</button></div>
            <div class="filtros-corpo">
                ${secao("biblioteca", "Biblioteca", `
                    <label class="filtro-opcao">Nível <select name="nivel">${Object.entries(NIVEIS_BIBLIOTECA).map(([valor, rotulo]) => `<option value="${valor}">${rotulo}</option>`).join("")}</select></label>
                    <div class="chips-filtro">${REINOS_BIBLIOTECA.map(reino => `
                        <label class="chip-filtro"><input type="checkbox" data-grupo="reinos" value="${reino}" /><span>${reino}</span></label>`).join("")}</div>
                    <label class="filtro-opcao"><input type="checkbox" name="soComFicha" /> Só com ficha completa (${facetas.total})</label>
                    <label class="filtro-opcao"><input type="checkbox" name="comNomePopular" /> Só com nome popular</label>`, { aberta: true })}
                <p class="filtro-aviso">Altura, função, estrato, luz, floração, ciclo, foto e referências só existem nas ${facetas.total} espécies com ficha completa: ao usar esses filtros, só elas aparecem.</p>
                ${secao("formas", "Forma de vida", chips("formas", facetas.formas, maiuscula), { aberta: true })}
                ${secao("altura", "Altura", `
                    <p class="filtro-nota">Sobre a altura máxima da espécie. Quem não tem altura informada fica de fora ao usar a faixa (${facetas.comAltura} de ${facetas.total} têm).</p>
                    <div class="faixa-altura">
                        <label>De <input type="number" name="alturaMin" min="0" step="0.5" inputmode="decimal" /> m</label>
                        <label>até <input type="number" name="alturaMax" min="0" step="0.5" inputmode="decimal" /> m</label>
                    </div>
                    <div class="chips-filtro">${[["0,3", "até 3 m"], ["3,6", "3 a 6 m"], ["6,10", "6 a 10 m"], ["10,20", "10 a 20 m"], ["20,", "acima de 20 m"]].map(([faixa, texto]) =>
                        `<button type="button" class="chip-filtro chip-botao" data-acao="altura" data-faixa="${faixa}">${texto}</button>`).join("")}</div>`, { aberta: true })}
                ${secao("funcoes", "Função", `${chips("funcoes", facetas.funcoes, rotuloDaFuncao)}
                    <label class="filtro-opcao"><input type="checkbox" name="funcoesTodas" /> Exigir todas as funções marcadas</label>`, { aberta: true })}
                ${secao("estratos", "Estrato no SAF", chips("estratos", facetas.estratos, v => ROTULO_ESTRATO[v] ?? v, ordemFixa(["emergente", "alto", "medio", "baixo"])),
                    { nota: `Só as espécies com estrato informado (${[...facetas.estratos.values()].reduce((a, b) => a + b, 0)} marcações).` })}
                ${secao("origens", "Origem", chips("origens", facetas.origens, v => ROTULO_ORIGEM[v] ?? v))}
                ${secao("luz", "Exigência de luz", chips("luz", facetas.luz, v => ROTULO_LUZ[v] ?? v, ordemFixa(["sol", "meia-sombra", "sombra"])))}
                ${secao("floracao", "Floresce em", meses("floracao"))}
                ${secao("frutificacao", "Frutifica em", meses("frutificacao"))}
                ${secao("ciclos", "Ciclo", chips("ciclos", facetas.ciclos, maiuscula))}
                ${secao("ufs", "Ocorre no estado", ufs.length ? `<div class="chips-filtro">${ufs.map(e => `
                    <label class="chip-filtro chip-mes"><input type="checkbox" data-grupo="ufs" value="${e.uf}" /><span title="${escaparHtml(e.nome)}">${e.uf} <small>${facetas.ufs.get(e.uf)}</small></span></label>`).join("")}</div>` : `<p class="filtro-vazio">Nenhuma espécie com estados identificados.</p>`)}
                ${secao("familias", "Família", `<label class="filtro-opcao">Família <select name="familiaUnica"><option value="">Qualquer</option>${familias.map(([nome, qtd]) =>
                        `<option value="${escaparHtml(nome)}">${escaparHtml(nome)} (${qtd})</option>`).join("")}</select></label>`)}
                ${secao("extras", "Foto e referências", `
                    <label class="filtro-opcao">Foto <select name="comFoto"><option value="">Todas</option><option value="sim">Só com foto (${facetas.comFoto})</option><option value="nao">Só sem foto</option></select></label>
                    <label class="filtro-opcao"><input type="checkbox" name="comReferencias" /> Só com referências bibliográficas (${facetas.comReferencias})</label>
                    <label class="filtro-opcao"><input type="checkbox" name="comAltura" /> Só com altura informada</label>`)}
            </div>
            <div class="filtros-rodape"><button type="button" class="botao-primario filtros-ver" data-acao="fechar">Ver plantas</button></div>`;
        this._aplicarNosControles();
    }

    _aplicarNosControles() {
        const d = this._dialogo;
        const f = this._filtros;
        d.querySelectorAll("input[data-grupo]").forEach(caixa => {
            const lista = f[caixa.dataset.grupo] ?? [];
            caixa.checked = lista.map(String).includes(caixa.value);
        });
        const campo = nome => d.querySelector(`[name="${nome}"]`);
        if (campo("nivel")) campo("nivel").value = f.nivel ?? "especie";
        if (campo("soComFicha")) campo("soComFicha").checked = !!f.soComFicha;
        if (campo("comNomePopular")) campo("comNomePopular").checked = !!f.comNomePopular;
        if (campo("alturaMin")) campo("alturaMin").value = f.alturaMin ?? "";
        if (campo("alturaMax")) campo("alturaMax").value = f.alturaMax ?? "";
        if (campo("funcoesTodas")) campo("funcoesTodas").checked = !!f.funcoesTodas;
        if (campo("comReferencias")) campo("comReferencias").checked = !!f.comReferencias;
        if (campo("comAltura")) campo("comAltura").checked = !!f.comAltura;
        if (campo("comFoto")) campo("comFoto").value = f.comFoto === true ? "sim" : f.comFoto === false ? "nao" : "";
        if (campo("familiaUnica")) campo("familiaUnica").value = f.familias?.[0] ?? "";
        // Quantos critérios há em cada seção (aparece ao lado do título, para achar o que está ligado).
        const marcados = {
            biblioteca: (f.nivel && f.nivel !== "especie" ? 1 : 0) + f.reinos.length + (f.soComFicha ? 1 : 0) + (f.comNomePopular ? 1 : 0),
            formas: f.formas.length, altura: f.alturaMin != null || f.alturaMax != null ? 1 : 0, funcoes: f.funcoes.length, estratos: f.estratos.length,
            origens: f.origens.length, luz: f.luz.length, floracao: f.floracao.length, frutificacao: f.frutificacao.length, ciclos: f.ciclos.length,
            ufs: f.ufs.length, familias: f.familias.length, extras: (f.comFoto !== null ? 1 : 0) + (f.comReferencias ? 1 : 0) + (f.comAltura ? 1 : 0)
        };
        d.querySelectorAll("[data-marcados]").forEach(el => { const n = marcados[el.dataset.marcados]; el.textContent = n ? `· ${n}` : ""; });
        d.querySelector('[data-acao="limpar"]')?.toggleAttribute("hidden", contarCriterios(f) === 0);
    }

    _ler() {
        const d = this._dialogo;
        const marcados = grupo => [...d.querySelectorAll(`input[data-grupo="${grupo}"]:checked`)].map(c => c.value);
        const numero = nome => { const v = d.querySelector(`[name="${nome}"]`)?.value; return v === "" || v === undefined ? null : Number(v); };
        const familia = d.querySelector('[name="familiaUnica"]')?.value;
        const foto = d.querySelector('[name="comFoto"]')?.value;
        return {
            formas: marcados("formas"), funcoes: marcados("funcoes"), funcoesTodas: !!d.querySelector('[name="funcoesTodas"]')?.checked,
            estratos: marcados("estratos"), origens: marcados("origens"), luz: marcados("luz"), ciclos: marcados("ciclos"),
            familias: familia ? [familia] : [], ufs: marcados("ufs"), floracao: marcados("floracao").map(Number), frutificacao: marcados("frutificacao").map(Number),
            nivel: d.querySelector('[name="nivel"]')?.value && d.querySelector('[name="nivel"]').value !== "especie" ? d.querySelector('[name="nivel"]').value : null,
            reinos: marcados("reinos"), soComFicha: d.querySelector('[name="soComFicha"]')?.checked ? true : null,
            comNomePopular: d.querySelector('[name="comNomePopular"]')?.checked ? true : null,
            alturaMin: numero("alturaMin"), alturaMax: numero("alturaMax"), comFoto: foto === "sim" ? true : foto === "nao" ? false : null,
            comReferencias: d.querySelector('[name="comReferencias"]')?.checked ? true : null, comAltura: d.querySelector('[name="comAltura"]')?.checked ? true : null
        };
    }

    _aoMudar() {
        this._filtros = this._ler();
        this._aplicarNosControles();
        this._emitir();
    }

    _emitir() {
        this.dispatchEvent(new CustomEvent("filtros-mudaram", { detail: { filtros: { ...this._filtros } } }));
    }
}

customElements.define("painel-filtros-especies", PainelFiltrosEspecies);
