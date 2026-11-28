import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import "./campo_coordenada.js";

/**
 * <dialogo-estacao>: diálogo de criar ou editar uma estação de nível (docs/especificacao.md
 * secao 4). Não conhece banco nem o GPS: recebe a função de captura e devolve um evento.
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em dialogo_estacao.html);
 * estado reativo: { titulo, rotuloSalvar, estacoesParaAmarrar, semAmarracao }.
 *
 * Entrada:
 *   capturador                       async () => coordenada | null (ver <campo-coordenada>)
 *   abrir({ estacoesParaAmarrar })   nova; [{ id, nome }] das estações que já têm ponto de amarração
 *   abrir({ estacao })               edição (a amarração não muda)
 *   fechar()
 * Eventos:
 *   "estacao-criada"   detail { nome, coordenada:{lat,lon,precisao}|null, amarradaAEstacaoId|null }
 *   "estacao-editada"  detail { id, nome, coordenada|null }
 *   "nome" pode vir vazio e "coordenada" nula nos dois.
 */
export class DialogoEstacao extends ReactiveComponent {

    constructor() {
        super({ templateUrl: "./dialogo_estacao.html", shadowDom: false }, import.meta.url);
    }

    connectedCallback() {
        if (!this.state) this.state = DialogoEstacao._estado({});
    }

    static _estado({ estacao = null, estacoesParaAmarrar = [] }) {
        return {
            titulo: estacao ? "Editar estação" : "Nova estação de nível",
            rotuloSalvar: estacao ? "Salvar alterações" : "Salvar estação",
            estacoesParaAmarrar,
            semAmarracao: estacoesParaAmarrar.length === 0
        };
    }

    onLoad() {
        super.onLoad();
        this._dialogo = this.querySelector("dialog");
        this._formulario = this.querySelector("form");
        this._campoCoordenada = this.querySelector("campo-coordenada");
        this._campoCoordenada.capturador = this._capturador;
    }

    set capturador(funcao) {
        this._capturador = funcao;
        if (this._campoCoordenada) this._campoCoordenada.capturador = funcao;
    }

    async abrir({ estacao = null, estacoesParaAmarrar = [] } = {}) {
        await this.whenLoaded();
        this._formulario.reset();
        this._idEmEdicao = estacao?.id ?? null;
        if (estacao?.coordenada) this._campoCoordenada.definir(estacao.coordenada);
        else this._campoCoordenada.limpar();
        if (estacao) this._formulario.elements.nome.value = estacao.nome;
        this.state = DialogoEstacao._estado({ estacao, estacoesParaAmarrar });
        this._dialogo.showModal();
    }

    fechar() {
        this._dialogo?.close();
    }

    aoEnviar(evento) {
        evento.preventDefault();
        const dados = new FormData(this._formulario);
        const comuns = {
            nome: dados.get("nome").trim(),
            coordenada: this._campoCoordenada.valor
        };
        this.dispatchEvent(this._idEmEdicao
            ? new CustomEvent("estacao-editada", { detail: { id: this._idEmEdicao, ...comuns } })
            : new CustomEvent("estacao-criada", { detail: { ...comuns, amarradaAEstacaoId: dados.get("amarrada_a") || null } }));
    }
}

customElements.define("dialogo-estacao", DialogoEstacao);
