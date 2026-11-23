import { RANGOS, RELACOES, PREFIXO_ID } from "../dominio/catalogo_nacional.js";
import { especieDoRegistro } from "../dominio/biblioteca_unificada.js";
import { ESTADOS_BRASIL } from "../dominio/estados_brasil.js";
import { escaparHtml } from "./util_dom.js";

const LIMITE_ITENS = 50;
const NOMES_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ROTULO_CICLO = { anual: "Anual", bienal: "Bienal", perene: "Perene" };
const humanizar = texto => String(texto).toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const nomeDoEstado = uf => ESTADOS_BRASIL.find(e => e.uf === uf)?.nome ?? uf;

const ROTULO_SECAO = {
    morfologia: "Características", madeira: "Madeira", utilidade: "Utilidade", ecologia: "Ecologia", fenologia: "Floração e frutificação",
    sementes: "Obtenção de sementes", mudas: "Produção de mudas", clima: "Clima", solos: "Solos",
    caracteristicas_silviculturais: "Características silviculturais", crescimento_e_producao: "Crescimento e produção",
    especies_afins: "Espécies afins", etimologia: "Etimologia", nomes_vulgares_por_uf: "Nomes populares por região",
    nomes_no_exterior: "Nomes no exterior", partes_usadas: "Partes usadas", experiencias_relevantes: "Experiências relevantes",
    aspectos_ecologicos_agronomicos_e_silviculturais: "Aspectos ecológicos, agronômicos e silviculturais"
};
/** "xxx__plantas_para_o_futuro" = a versão do mesmo tópico no outro livro (a espécie está nos dois). */
const rotuloDaSecao = chave => {
    const [base, outroLivro] = chave.split("__");
    return (ROTULO_SECAO[base] ?? humanizar(base)) + (outroLivro ? " (Plantas para o Futuro)" : "");
};

/** { min, max } → "60 a 90 cm" (ou só um lado); null se vazio. */
function textoDeFaixa(faixa, unidade) {
    if (!faixa || (faixa.min == null && faixa.max == null)) return null;
    const numeros = faixa.min != null && faixa.max != null && faixa.min !== faixa.max ? `${faixa.min} a ${faixa.max}` : `${faixa.min ?? faixa.max}`;
    return `${numeros} ${unidade}`;
}

/**
 * <ficha-taxon>: a ficha (uma tela, não um diálogo) de um registro da biblioteca (docs/especificacao.md §15): se a espécie
 * tem ficha completa, mostra fotos e todos os dados ricos; sempre mostra a taxonomia, a hierarquia, os sinônimos, as
 * relações entre nomes, as referências e os espécimes-tipo do catálogo, com os registros relacionados como botões.
 * Só desenha e avisa; quem busca os dados e guarda a navegação (histórico) é quem usa.
 *
 * Entrada:
 *   mostrar(contexto)   contexto = resultado de `contextoDoTaxon` (db/catalogo_nacional.js)
 * Eventos (CustomEvent):
 *   "taxon-solicitado"  detail { id }  tocou num registro relacionado
 *   "editar-ficha"      detail { id }  tocou no lápis (criar a ficha, se ainda não tem, ou editá-la)
 *   "remover-ficha"     detail { id }  tocou na lixeira (só aparece quando há ficha)
 */
export class FichaTaxon extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this.innerHTML = `<article class="ficha-taxon"></article>`;
        this._raiz = this.querySelector("article");
        this._raiz.addEventListener("click", evento => {
            const link = evento.target.closest("[data-taxon-id]");
            if (link) { this.dispatchEvent(new CustomEvent("taxon-solicitado", { detail: { id: link.dataset.taxonId } })); return; }
            const acao = evento.target.closest("[data-acao]")?.dataset.acao;
            if (acao === "editar-ficha" || acao === "remover-ficha") this.dispatchEvent(new CustomEvent(acao, { detail: { id: this._taxon.id } }));
        });
    }

    mostrar(contexto) {
        this.connectedCallback();
        const { taxon } = contexto;
        this._taxon = taxon;
        const especie = especieDoRegistro(taxon);
        const rica = !!taxon.ficha;
        const populares = taxon.p ?? [];
        const sinonimo = taxon.nv === "sinonimo";

        const html = [];
        html.push(`<div class="ficha-titulo">
            <div class="ficha-titulo-texto">
                <h2 class="detalhe-nome">${escaparHtml(especie.nome_popular)}</h2>
                <p class="detalhe-cientifico">${taxon.sem_cientifico ? "" : `<em>${escaparHtml(taxon.c)}</em> ${escaparHtml(taxon.a ?? "")}`}</p>
            </div>
            <div class="ficha-icones">
                <button type="button" class="botao-icone" data-acao="editar-ficha" aria-label="${rica ? "Editar a ficha" : "Criar a ficha"}" title="${rica ? "Editar" : "Criar ficha"}">✏️</button>
                ${rica ? `<button type="button" class="botao-icone" data-acao="remover-ficha" aria-label="${taxon.propria ? "Excluir espécie" : "Remover a ficha"}" title="${taxon.propria ? "Excluir" : "Remover ficha"}">🗑</button>` : ""}
            </div>
        </div>`);
        html.push(`<p class="selos-taxon">${[
            rica ? "⭐ Ficha completa" : null,
            RANGOS[taxon.k] ?? taxon.k,
            sinonimo ? "Sinônimo" : taxon.st === "A" ? "Nome aceito" : taxon.propria ? "Espécie própria" : "Status indefinido",
            taxon.ns ? humanizar(taxon.ns) : null,
            taxon.o ? humanizar(taxon.o) : null
        ].filter(Boolean).map(t => `<span class="selo-taxon">${escaparHtml(t)}</span>`).join("")}</p>`);

        if (sinonimo && contexto.aceito) {
            html.push(`<p class="aviso-sinonimo">Sinônimo de ${this._link(contexto.aceito)} — o nome aceito hoje.</p>`);
        } else if (sinonimo) {
            html.push(`<p class="aviso-sinonimo">Sinônimo (o nome aceito não consta no catálogo).</p>`);
        }
        if (contexto.ancestrais.length) {
            html.push(`<p class="hierarquia-taxon">${contexto.ancestrais.map(a => this._link(a, { curto: true })).join(" › ")}</p>`);
        }

        // Galeria de fotos (rola de lado), cada uma com legenda e crédito do fotógrafo.
        if (especie.fotos.length) {
            html.push(`<div class="detalhe-fotos">${especie.fotos.map(foto => {
                const legenda = [foto.legenda, foto.credito ? `Foto: ${foto.credito}` : null].filter(Boolean).join(" — ");
                return `<figure><img src="${escaparHtml(foto.src)}" alt="${escaparHtml(foto.legenda ?? especie.nome_popular)}" />${legenda ? `<figcaption>${escaparHtml(legenda)}</figcaption>` : ""}</figure>`;
            }).join("")}</div>`);
        }

        if (rica) html.push(this._dadosDaFicha(especie));

        const secoes = [];
        if (rica) secoes.push(...this._secoesDaFicha(especie));
        secoes.push(this._secao(rica ? "Taxonomia e distribuição (JBRJ)" : "Taxonomia e distribuição", this._dadosDoTaxon(taxon, populares), !rica));

        // Relações nomenclaturais, agrupadas pelo tipo (o texto lê "<esta espécie> é sinônimo (homotípico) de …").
        const porTipo = new Map();
        for (const { tipo, taxon: outro } of contexto.relacionadas) porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), outro]);
        if (porTipo.size) {
            secoes.push(this._secao(`Relações nomenclaturais (${contexto.relacionadas.length})`, [...porTipo].map(([tipo, lista]) =>
                `<p class="rotulo-relacao">${escaparHtml(RELACOES[tipo] ?? RELACOES["?"])}</p><ul class="lista-taxons">${lista.map(t => `<li>${this._link(t)}</li>`).join("")}</ul>`).join("")));
        }
        if (contexto.original) secoes.push(this._secao("Nome original (basiônimo)", `<ul class="lista-taxons"><li>${this._link(contexto.original)}</li></ul>`));
        if (contexto.derivados.length) secoes.push(this._secao(`Nomes que partem deste (${contexto.derivados.length})`, this._lista(contexto.derivados)));
        if (contexto.totalSinonimos) secoes.push(this._secao(`Sinônimos (${contexto.totalSinonimos})`, this._lista(contexto.sinonimos, contexto.totalSinonimos)));
        if (contexto.totalFilhos) secoes.push(this._secao(`Contém (${contexto.totalFilhos})`, this._lista(contexto.filhos, contexto.totalFilhos), !sinonimo && !rica));
        if (taxon.rf?.length) {
            const itens = taxon.rf.slice(0, LIMITE_ITENS).map(([citacao, titulo, autor, data, tipo, identificador]) => {
                const texto = [autor, data ? `(${data})` : null, citacao || titulo].filter(Boolean).join(" ");
                const link = /^https?:/.test(identificador) ? ` <a href="${escaparHtml(identificador)}" target="_blank" rel="noopener">link</a>` : "";
                return `<li>${escaparHtml(texto)}${tipo ? ` <span class="selo-taxon">${escaparHtml(tipo === "original description" ? "descrição original" : tipo)}</span>` : ""}${link}</li>`;
            }).join("");
            secoes.push(this._secao(`Publicação do nome (${taxon.rf.length})`, `<ul class="lista-referencias">${itens}</ul>${this._maisItens(taxon.rf.length)}`));
        }
        if (taxon.tp?.length) {
            const itens = taxon.tp.slice(0, LIMITE_ITENS).map(([status, herbario, numero, local, coletor, fonte]) => {
                const texto = [status, herbario, numero, local, coletor].filter(Boolean).join(" · ");
                return `<li>${escaparHtml(texto || "espécime sem detalhes")}${fonte ? `<br><small>${escaparHtml(fonte)}</small>` : ""}</li>`;
            }).join("");
            secoes.push(this._secao(`Espécimes-tipo (${taxon.tp.length})`, `<ul class="lista-referencias">${itens}</ul>${this._maisItens(taxon.tp.length)}`));
        }
        html.push(`<div class="detalhe-extras">${secoes.join("")}</div>`);

        if (taxon.id.startsWith(PREFIXO_ID)) {
            html.push(`<p class="detalhe-fontes">Taxonomia: Flora e Funga do Brasil (JBRJ), CC BY 4.0 — <a href="http://reflora.jbrj.gov.br/reflora/listaBrasil/FichaPublicaTaxonUC/FichaPublicaTaxonUC.do?id=FB${escaparHtml(taxon.id.slice(PREFIXO_ID.length))}" target="_blank" rel="noopener">ficha original</a></p>`);
        }
        this._raiz.innerHTML = html.join("");
    }

    /** Os dados ricos da ficha, como lista de rótulo/valor. */
    _dadosDaFicha(e) {
        const altura = e.altura_min_m && e.altura_max_m
            ? (e.altura_min_m === e.altura_max_m ? `${e.altura_min_m} m` : `${e.altura_min_m} a ${e.altura_max_m} m`)
            : ((e.altura_max_m ?? e.altura_min_m) ? `${e.altura_max_m ?? e.altura_min_m} m` : null);
        const lista = valores => (valores?.length ? valores.join(", ") : null);
        const meses = valores => (valores?.length ? valores.map(m => NOMES_MESES[m - 1]).join(", ") : null);
        const itens = [
            ["Outros nomes populares", lista(e.nomes_populares?.slice(1))],
            ["Família", e.familia],
            ["Forma de vida", e.forma_de_vida],
            ["Origem", e.origem],
            ["Altura", altura],
            ["Observação sobre a altura", e.altura_observacao],
            ["Estrato sugerido no SAF", e.estrato_saf],
            ["Exigência de luz", e.exigencia_luminosa],
            ["Funções no SAF", lista(e.funcoes?.map(f => f.replaceAll("_", " ")))],
            ["Partes utilizadas", lista(e.partes_utilizadas)],
            ["Usos", lista(e.usos)],
            ["Ciclo", e.ciclo ? ROTULO_CICLO[e.ciclo] : null],
            ["Espaçamento recomendado", e.espacamento_recomendado_m ? `${e.espacamento_recomendado_m.toLocaleString("pt-BR")} m` : null],
            ["Diâmetro do tronco", textoDeFaixa(e.diametro_tronco_cm, "cm")],
            ["Densidade da madeira", e.densidade_madeira_g_cm3 ? `${e.densidade_madeira_g_cm3.toLocaleString("pt-BR")} g/cm³` : null],
            ["Floração", meses(e.floracao_meses)],
            ["Frutificação", meses(e.frutificacao_meses)],
            ["Sementes por kg (aprox.)", e.sementes_por_kg ? e.sementes_por_kg.toLocaleString("pt-BR") : null],
            ["Viabilidade das sementes armazenadas", e.viabilidade_sementes ? `${e.viabilidade_sementes} meses` : null],
            ["Taxa de germinação", e.taxa_germinacao],
            ["Emergência das plântulas", textoDeFaixa(e.emergencia_dias, "dias")],
            ["Germinação", textoDeFaixa(e.germinacao_meses, "meses")],
            ["Mudas prontas em", textoDeFaixa(e.mudas_prontas_meses, "meses")],
            ["Atenção à conservação", e.advertencia_conservacao],
            ["Subfamília", e.subfamilia],
            ["Taxonomia alternativa", e.taxonomia_alternativa],
            ["Exsicata / referência botânica", e.referencia_botanica],
            ["Ocorrência", e.ocorrencia_texto],
            ["Notas", e.notas],
            ["Fonte", e.fonte_primaria
                ? [e.fonte_primaria.titulo_da_obra, e.fonte_primaria.pagina ? `página ${e.fonte_primaria.pagina}` : null, e.fonte_primaria.nota].filter(Boolean).join(" — ")
                : null],
            // Dados que o catálogo trouxe e o app ainda não conhece: aparecem como vieram.
            ...Object.entries(e.extras ?? {}).map(([chave, valor]) =>
                [humanizar(chave.split(".").pop()), typeof valor === "string" ? valor : JSON.stringify(valor)])
        ].filter(([, valor]) => valor);
        return `<dl class="detalhe-lista">${itens.map(([r, v]) => `<dt>${escaparHtml(r)}</dt><dd>${escaparHtml(v)}</dd>`).join("")}</dl>`;
    }

    /** Descrições longas (e referências bibliográficas da ficha) ficam recolhidas, para a ficha não virar uma parede de texto. */
    _secoesDaFicha(e) {
        const detalhes = e.detalhes ?? {};
        const conhecidas = Object.keys(ROTULO_SECAO).filter(c => detalhes[c]);
        const outras = Object.keys(detalhes).filter(c => !(c in ROTULO_SECAO));
        const secoes = [...conhecidas, ...outras].filter(c => detalhes[c])
            .map(c => this._secao(rotuloDaSecao(c), `<p>${escaparHtml(detalhes[c])}</p>`));
        if (e.referencias?.length) {
            secoes.push(this._secao(`Referências bibliográficas (${e.referencias.length})`,
                `<ul class="lista-referencias">${e.referencias.map(t => `<li>${escaparHtml(t)}</li>`).join("")}</ul>`));
        }
        if (e.fontes?.length) {
            secoes.push(`<p class="detalhe-fontes">Fontes: ${e.fontes.map(url => `<a href="${escaparHtml(url)}" target="_blank" rel="noopener">${escaparHtml(url.replace(/^https?:\/\//, "").slice(0, 60))}</a>`).join(" · ")}</p>`);
        }
        return secoes;
    }

    _dadosDoTaxon(taxon, populares) {
        const dados = [
            ["Família", taxon.f], ["Reino", taxon.r !== "—" ? taxon.r : null], ["Filo", taxon.fi], ["Classe", taxon.cl], ["Ordem", taxon.or],
            ["Nomes populares", populares.length ? populares.map(n => taxon.pv?.[n] ? `${n} (${taxon.pv[n]})` : n).join(", ") : null],
            ...Object.entries(taxon.n ?? {}).map(([idioma, nomes]) => [`Nomes em ${humanizar(idioma)}`, nomes.join(", ")]),
            ["Forma de vida", taxon.v?.join(", ")], ["Habitat", taxon.h?.join(", ")], ["Tipos de vegetação", taxon.vg?.join(", ")],
            ["Nativa em", taxon.ufn?.map(nomeDoEstado).join(", ")], ["Exótica em", taxon.ufe?.map(nomeDoEstado).join(", ")],
            ["Ocorre em", !taxon.ufn?.length && !taxon.ufe?.length ? taxon.uf?.map(nomeDoEstado).join(", ") : null],
            ["Domínios fitogeográficos", taxon.d?.join(", ")], ["Endemismo", taxon.e?.join(", ")],
            ["Publicação do nome", [taxon.pub, taxon.ano && !taxon.pub?.includes(taxon.ano) ? taxon.ano : null].filter(Boolean).join(" — ") || null],
            ["Atualizado em", taxon.md]
        ].filter(([, valor]) => valor);
        return `<dl class="detalhe-lista">${dados.map(([r, v]) => `<dt>${escaparHtml(r)}</dt><dd>${escaparHtml(v)}</dd>`).join("")}</dl>`;
    }

    _link(taxon, { curto = false } = {}) {
        const complemento = curto ? "" : ` <small>${escaparHtml([taxon.a, RANGOS[taxon.k] && taxon.k !== "sp" ? RANGOS[taxon.k] : null].filter(Boolean).join(" · "))}</small>`;
        return `<button type="button" class="taxon-link" data-taxon-id="${escaparHtml(taxon.id)}"><em>${escaparHtml(taxon.c)}</em>${complemento}</button>`;
    }

    _lista(lista, total = lista.length) {
        return `<ul class="lista-taxons">${lista.map(t => `<li>${this._link(t)}</li>`).join("")}</ul>${total > lista.length ? `<p class="detalhe-fontes">… e mais ${total - lista.length}. Busque pelo nome para ver os demais.</p>` : ""}`;
    }

    _maisItens(total) {
        return total > LIMITE_ITENS ? `<p class="detalhe-fontes">Mostrando ${LIMITE_ITENS} de ${total}.</p>` : "";
    }

    _secao(titulo, conteudo, aberta = false) {
        return `<details${aberta ? " open" : ""}><summary>${escaparHtml(titulo)}</summary>${conteudo}</details>`;
    }
}

customElements.define("ficha-taxon", FichaTaxon);
