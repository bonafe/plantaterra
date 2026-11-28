import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import { formatarCentimetros, corDaAltitude, GRADIENTE_CALOR } from "./util_dom.js";
import { contarAlturasSuspeitas, faixasDeAltitudePorEstacao, idsDasLeiturasZero } from "../dominio/nivelamento.js";

/**
 * <lista-estacoes>: estações de nível e suas leituras (num bloco expansível), com
 * os botões de editar e "+ Leitura nesta estação".
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em lista_estacoes.html).
 * A lista é "keyed" por id: ao chegar dados novos, os blocos que já existiam são
 * reaproveitados — um bloco que a pessoa deixou aberto continua aberto.
 *
 * Cada leitura tem a cor da sua altitude (a mesma do ponto no mapa). Com mouse, passar por cima aponta a
 * leitura; clicar ou tocar a seleciona (de novo, solta).
 *
 * Entrada:  estacoes = [{ estacao, leituras }]
 *           selecionar(leituraId | null)  marca a leitura, abre o bloco dela e rola até ela
 * Eventos:  "leitura-destacada"           detail { leituraId | null }
 *           "zero-solicitado"             detail { leituraId }
 *           "nova-leitura-solicitada"     detail { estacaoId }
 *           "editar-estacao-solicitada"   detail { estacaoId }
 *           "editar-leitura-solicitada"   detail { estacaoId, leituraId }
 *           "corrigir-alturas-solicitado" detail { quantidade }
 */
export class ListaEstacoes extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./lista_estacoes.html", shadowDom: false }, import.meta.url);
    }

    connectedCallback() {
        if (!this.state) this.state = { itens: [], vazia: true, temSuspeitas: false };
    }

    set estacoes(lista) {
        const nomePorId = new Map(lista.map(({ estacao }) => [estacao.id, estacao.nome]));
        this._suspeitas = contarAlturasSuspeitas(lista);
        const faixas = faixasDeAltitudePorEstacao(lista);
        const zeros = idsDasLeiturasZero(lista);
        // O template só interpola caminhos ({{ a.b }}), sem formatação: o texto já vem pronto.
        this.state = {
            vazia: lista.length === 0,
            gradiente: GRADIENTE_CALOR,
            temSuspeitas: this._suspeitas > 0,
            textoSuspeitas: `⚠️ ${this._suspeitas} leitura(s) acima de 10 m: parece que foram digitadas em cm quando o campo era em metros.`,
            itens: lista.map(({ estacao, leituras }) => ({
                id: estacao.id,
                nome: estacao.nome,
                ligacao: this._descreverLigacao(estacao, leituras, lista, nomePorId),
                resumoLeituras: leituras.length === 0 ? "Nenhuma leitura ainda"
                    : leituras.length === 1 ? "1 leitura" : `${leituras.length} leituras`,
                temEscala: leituras.length > 0,
                minimo: formatarCentimetros(faixas.get(estacao.id).minimo),
                maximo: formatarCentimetros(faixas.get(estacao.id).maximo),
                leituras: leituras.map(leitura => ({
                    id: leitura.id,
                    ativa: leitura.id === this._selecionada,
                    zero: zeros.has(leitura.id),
                    mostrarZero: leitura.id === this._selecionada && !zeros.has(leitura.id),
                    cor: corDaAltitude(leitura.altitude_relativa, faixas.get(estacao.id)),
                    texto: (leitura.nome ? `${leitura.nome}: ` : "") + `mira ${formatarCentimetros(leitura.altura_mira)} → altitude ${formatarCentimetros(leitura.altitude_relativa)}` +
                        (zeros.has(leitura.id) ? " 📍 zero" : "") +
                        (leitura.eh_ponto_amarracao ? " 🔗 amarração" : "") +
                        (faixas.get(estacao.id).destoantes.has(leitura.id) ? " ⚠️ muito diferente das outras: confira" : "")
                }))
            }))
        };
    }

    _descreverLigacao(estacao, leituras, lista, nomePorId) {
        const referenciaId = estacao.amarrada_a_estacao_id;
        if (!referenciaId) return "referência própria";
        const temAmarracao = itens => itens?.some(l => l.eh_ponto_amarracao);
        const referencia = lista.find(item => item.estacao.id === referenciaId);
        const nome = nomePorId.get(referenciaId) ?? "?";
        return temAmarracao(leituras) && temAmarracao(referencia?.leituras)
            ? `amarrada a ${nome}`
            : `⚠️ falta a leitura de amarração com ${nome}`;
    }

    selecionar(leituraId) {
        this._selecionada = leituraId;
        if (!this.state?.itens) return;
        this.state = {
            ...this.state,
            itens: this.state.itens.map(item => ({
                ...item,
                leituras: item.leituras.map(l => ({ ...l, ativa: l.id === leituraId, mostrarZero: l.id === leituraId && !l.zero }))
            }))
        };
        const elemento = leituraId && this.querySelector(`[data-leitura="${CSS.escape(leituraId)}"]`);
        if (elemento) {
            elemento.closest("details").open = true;
            elemento.scrollIntoView({ block: "nearest" });
        }
    }

    selecionarLeitura(evento, escopo) {
        if (evento.target.closest(".botao-editar, .botao-zero")) return;
        const id = escopo.l.id === this._selecionada ? null : escopo.l.id;
        this.selecionar(id);
        this._emitir("leitura-destacada", { leituraId: id });
    }

    definirZero(evento, escopo) {
        this._emitir("zero-solicitado", { leituraId: escopo.l.id });
    }

    // Só o mouse "passa por cima"; no toque vale o clique.
    apontarLeitura(evento, escopo) {
        if (evento.pointerType === "mouse") this._emitir("leitura-destacada", { leituraId: escopo.l.id });
    }

    soltarLeitura(evento) {
        if (evento.pointerType === "mouse") this._emitir("leitura-destacada", { leituraId: this._selecionada ?? null });
    }

    novaLeitura(evento, escopo) {
        this._emitir("nova-leitura-solicitada", { estacaoId: escopo.e.id });
    }

    editarEstacao(evento, escopo) {
        this._emitir("editar-estacao-solicitada", { estacaoId: escopo.e.id });
    }

    editarLeitura(evento, escopo) {
        this._emitir("editar-leitura-solicitada", { estacaoId: escopo.e.id, leituraId: escopo.l.id });
    }

    corrigirAlturas() {
        this._emitir("corrigir-alturas-solicitado", { quantidade: this._suspeitas });
    }

    _emitir(nome, detail) {
        this.dispatchEvent(new CustomEvent(nome, { detail }));
    }
}

customElements.define("lista-estacoes", ListaEstacoes);
