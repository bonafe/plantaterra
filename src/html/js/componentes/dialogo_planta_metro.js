import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import { formatarDataSimples, parsearDataBr } from "./util_dom.js";
import { normalizarNome } from "../dominio/biblioteca_plantas.js";

/**
 * <dialogo-planta-metro>: diálogo das plantas de um metro de uma linha de
 * plantio (docs/especificacao.md secao 14.6) — lista o que já está plantado e
 * deixa adicionar/remover. Não conhece banco nem mapa: recebe dados, devolve eventos.
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em dialogo_planta_metro.html);
 * estado reativo: { titulo, vazia, plantas, sugestoes }.
 *
 * Entrada:
 *   especies = [{ id, nome_popular, nome_cientifico }]  sugestões da biblioteca (opcional)
 *   abrir({ titulo, plantas })   abre (ou, se já aberto, só atualiza título e lista). NÃO é modal
 *                                (show, não showModal): vira um painel no fluxo da tela e quem usa
 *                                decide o layout — o painel do projeto deixa o mapa grande acima dele
 *   fechar()
 *   aberto                       leitura
 *
 * Eventos (CustomEvent):
 *   "planta-adicionada"  detail { especie, especieId|null, quantidade|null, observacao|null, dataPlantio|null }
 *                        especieId só vem preenchido se o nome digitado (sem caixa/acento) é de uma espécie da biblioteca
 *   "planta-removida"    detail { id }
 *   "fechado"            o diálogo foi fechado (por qualquer meio)
 */
export class DialogoPlantaMetro extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./dialogo_planta_metro.html", shadowDom: false }, import.meta.url);
        this._especies = [];
    }

    connectedCallback() {
        if (!this.state) this.state = { titulo: "", vazia: true, plantas: [], sugestoes: [] };
    }

    onLoad() {
        super.onLoad();
        this._dialogo = this.querySelector("dialog");
        this._formulario = this.querySelector("form");
        // O evento nativo "close" não borbulha: reemite para quem usa o componente.
        this._dialogo.addEventListener("close", () => this.dispatchEvent(new CustomEvent("fechado")));
    }

    get aberto() { return this._dialogo?.open ?? false; }

    set especies(lista) {
        this._especies = lista ?? [];
        this.state = {
            ...this.state,
            sugestoes: this._especies.map(e => ({ id: e.id, nome: e.nome_popular, cientifico: e.nome_cientifico ?? "" }))
        };
    }

    async abrir({ titulo, plantas }) {
        await this.whenLoaded();
        this.state = {
            ...this.state,
            titulo,
            vazia: plantas.length === 0,
            plantas: plantas.map(p => ({
                id: p.id,
                especie: p.especie,
                detalhes: (p.quantidade ? ` (x${p.quantidade})` : "") +
                    (p.observacao ? ` — ${p.observacao}` : "") +
                    (p.data_plantio ? ` — plantado em ${formatarDataSimples(p.data_plantio)}` : "")
            }))
        };
        if (!this._dialogo.open) {
            this._formulario.reset();
            this._dialogo.show();
        }
    }

    fechar() {
        this._dialogo?.close();
    }

    remover(evento, escopo) {
        this.dispatchEvent(new CustomEvent("planta-removida", { detail: { id: escopo.p.id } }));
    }

    mascararData(evento) {
        const campo = evento.target;
        const digitos = campo.value.replace(/\D/g, "").slice(0, 8);
        if (digitos.length > 4) {
            campo.value = `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
        } else if (digitos.length > 2) {
            campo.value = `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
        } else {
            campo.value = digitos;
        }
    }

    aoEnviar(evento) {
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
    }
}

customElements.define("dialogo-planta-metro", DialogoPlantaMetro);
