import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import { formatarMetros } from "./util_dom.js";

/**
 * <lista-estacoes>: estações de nível e suas leituras, cada uma num bloco
 * expansível com o botão "+ Leitura nesta estação".
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em lista_estacoes.html).
 * A lista é "keyed" por id: ao chegar dados novos, os blocos que já existiam são
 * reaproveitados — um bloco que a pessoa deixou aberto continua aberto.
 *
 * Entrada:  estacoes = [{ estacao, leituras }]
 * Eventos:  "nova-leitura-solicitada"  detail { estacaoId }
 */
export class ListaEstacoes extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./lista_estacoes.html", shadowDom: false }, import.meta.url);
    }

    connectedCallback() {
        if (!this.state) this.state = { itens: [], vazia: true };
    }

    set estacoes(lista) {
        // O template só interpola caminhos ({{ a.b }}), sem formatação: o texto já vem pronto.
        this.state = {
            vazia: lista.length === 0,
            itens: lista.map(({ estacao, leituras }) => ({
                id: estacao.id,
                nome: estacao.nome,
                alturaInstrumento: formatarMetros(estacao.altura_instrumento),
                offset: formatarMetros(estacao.offset_altitude),
                leituras: leituras.map(leitura => ({
                    id: leitura.id,
                    texto: `mira: ${formatarMetros(leitura.altura_mira)} → altitude: ${formatarMetros(leitura.altitude_relativa, 2)}` +
                        (leitura.eh_ponto_amarracao ? " 🔗 amarração" : "")
                }))
            }))
        };
    }

    novaLeitura(evento, escopo) {
        this.dispatchEvent(new CustomEvent("nova-leitura-solicitada", { detail: { estacaoId: escopo.e.id } }));
    }
}

customElements.define("lista-estacoes", ListaEstacoes);
