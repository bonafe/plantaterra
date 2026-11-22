import { ReactiveComponent } from "../../vendor/ultima/reactive_component.js";
import { descreverIdadePlantio, formatarDataSimples, parsearDataBr } from "./util_dom.js";
import { acharPlantaIgual } from "../dominio/saf.js";
import "./card_planta.js";
import "./campo_limpavel.js";
import { normalizarNome, segmentarDestaque } from "../dominio/biblioteca_plantas.js";

/**
 * <dialogo-planta-metro>: diálogo das plantas de um metro de uma linha de
 * plantio (docs/especificacao.md secao 14.6) — lista o que já está plantado e
 * deixa adicionar/remover. Não conhece banco nem mapa: recebe dados, devolve eventos.
 *
 * Feito sobre o ReactiveComponent do UltimaJS (template em dialogo_planta_metro.html);
 * estado reativo: { titulo, vazia, plantas (cards), opcoes (autocomplete), formularioAberto, ... }.
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
 *   "planta-atualizada"  detail { id, parcial, especie, especieId, quantidade, sementes, observacao, dataPlantio } — edição de uma
 *                        planta (parcial=false: o formulário substitui tudo) ou "atualizar a existente" ao repetir a espécie
 *                        no mesmo metro (parcial=true: só o que foi preenchido substitui)
 *   "planta-adicionada"  detail { especie, especieId|null, quantidade|null, sementes|null, observacao|null, dataPlantio|null }
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
        if (!this.state) {
            this.state = {
                titulo: "", vazia: true, plantas: [],
                opcoes: [], semOpcoes: true, semAviso: true,
                formularioAberto: false, formularioFechado: true,
                tituloFormulario: "Adicionar planta", rotuloEnviar: "Adicionar planta",
                semConflito: true, conflitoAtivo: false, textoConflito: ""
            };
        }
    }

    onLoad() {
        super.onLoad();
        this._dialogo = this.querySelector("dialog");
        this._formulario = this.querySelector("form");
        // O evento nativo "close" não borbulha: reemite para quem usa o componente.
        this._dialogo.addEventListener("acao-card", evento => {
            const id = evento.target.dataset.id;
            if (evento.detail.acao === "remover") {
                this.dispatchEvent(new CustomEvent("planta-removida", { detail: { id } }));
            } else if (evento.detail.acao === "abrir") {
                this._editar(this._plantas.find(p => p.id === id));
            }
        });
        this._dialogo.addEventListener("close", () => this.dispatchEvent(new CustomEvent("fechado")));
    }

    get aberto() { return this._dialogo?.open ?? false; }

    set especies(lista) {
        this._especies = lista ?? [];
    }

    /** Espécie da biblioteca de uma planta: pelo vínculo (especie_id) ou, nas antigas, pelo nome — só se o nome identifica uma espécie só. */
    _especieDaPlanta(planta) {
        const porId = this._especies.find(e => e.id === planta.especie_id);
        if (porId) return porId;
        const porNome = this._especies.filter(e => normalizarNome(e.nome_popular) === normalizarNome(planta.especie));
        return porNome.length === 1 ? porNome[0] : undefined;
    }

    async abrir({ titulo, plantas }) {
        await this.whenLoaded();
        this._plantas = plantas;
        this.state = {
            ...this.state,
            titulo,
            vazia: plantas.length === 0,
            plantas: plantas.map(p => {
                const daBiblioteca = this._especieDaPlanta(p);
                return {
                    id: p.id,
                    card: {
                        nome: p.especie,
                        cientifico: daBiblioteca?.nome_cientifico ?? "",
                        linhas: [
                            p.data_plantio ? descreverIdadePlantio(p.data_plantio) : "",
                            [p.quantidade ? `${p.quantidade} planta(s)` : "", p.sementes ? `${p.sementes} semente(s)` : "", p.observacao ?? ""].filter(Boolean).join(" · ")
                        ],
                        acoes: [{ acao: "remover", icone: "🗑", rotulo: "Remover" }],
                        clicavel: true
                    }
                };
            })
        };
        if (!this._dialogo.open) {
            this._formulario.reset();
            this._definirFormularioAberto(false);
            this._dialogo.show();
        }
    }

    /** `editando` = planta que está sendo editada (null = adicionando uma nova). */
    _definirFormularioAberto(aberto, editando = null) {
        this._editandoId = editando?.id ?? null;
        this._pendente = null;
        this._escolhida = null;
        this.state = {
            ...this.state,
            formularioAberto: aberto,
            formularioFechado: !aberto,
            opcoes: [], semOpcoes: true, semAviso: true,
            tituloFormulario: editando ? "Editar planta" : "Adicionar planta",
            rotuloEnviar: editando ? "Salvar alterações" : "Adicionar planta",
            semConflito: true, conflitoAtivo: false
        };
    }

    abrirFormulario() {
        this._formulario.reset();
        this._definirFormularioAberto(true);
        requestAnimationFrame(() => this._formulario.elements.especie.focus());
    }

    /** Tocar no card de uma planta já adicionada abre o formulário preenchido para editar. */
    _editar(planta) {
        if (!planta) return;
        this._formulario.reset();
        const campos = this._formulario.elements;
        campos.especie.value = planta.especie;
        campos.quantidade.value = planta.quantidade ?? "";
        campos.sementes.value = planta.sementes ?? "";
        campos.observacao.value = planta.observacao ?? "";
        campos.data_plantio.value = planta.data_plantio ? formatarDataSimples(planta.data_plantio) : "";
        this._definirFormularioAberto(true, planta);
        // A espécie já vinculada continua a escolhida (mesmo que outra tenha o mesmo nome popular).
        this._escolhida = this._especies.find(e => e.id === planta.especie_id) ?? null;
        campos.especie.dispatchEvent(new Event("input", { bubbles: true }));
        this._formulario.scrollIntoView({ block: "nearest" });
    }

    fecharFormulario() {
        this._formulario.reset();
        this._definirFormularioAberto(false);
    }

    // ---- Mesma espécie no mesmo metro: perguntar se é nova ou atualização ----

    adicionarComoNova() {
        const { existenteId, ...detalhe } = this._pendente;
        this._formulario.reset();
        this._definirFormularioAberto(false);
        this.dispatchEvent(new CustomEvent("planta-adicionada", { detail: detalhe }));
    }

    atualizarExistente() {
        const { existenteId, ...detalhe } = this._pendente;
        this._formulario.reset();
        this._definirFormularioAberto(false);
        // parcial: só o que foi preenchido substitui; campo em branco mantém o que já estava.
        this.dispatchEvent(new CustomEvent("planta-atualizada", { detail: { id: existenteId, parcial: true, ...detalhe } }));
    }

    voltarDoConflito() {
        this._pendente = null;
        this.state = { ...this.state, semConflito: true, conflitoAtivo: false };
    }

    /**
     * Filtra a biblioteca enquanto a pessoa digita (nome popular OU científico, sem caixa/acento) e destaca o
     * trecho encontrado. Se o nome popular bate com UMA espécie só, vincula direto; se bate com várias
     * (mesmo nome popular, espécies diferentes), a lista continua aberta para a pessoa desambiguar.
     */
    aoDigitarEspecie(evento) {
        const consulta = normalizarNome(evento.target.value);
        // A escolha da lista só vale enquanto o texto continuar sendo o nome da espécie escolhida.
        if (this._escolhida && normalizarNome(this._escolhida.nome_popular) !== consulta) this._escolhida = null;
        if (this._escolhida) {
            this.state = { ...this.state, opcoes: [], semOpcoes: true, semAviso: true };
            return;
        }

        const exatas = this._especies.filter(e => normalizarNome(e.nome_popular) === consulta);
        const comecaCom = e => normalizarNome(e.nome_popular).startsWith(consulta);
        const opcoes = !consulta || exatas.length === 1 ? [] : this._especies
            .filter(e => normalizarNome(e.nome_popular).includes(consulta) || normalizarNome(e.nome_cientifico).includes(consulta))
            .sort((a, b) => Number(comecaCom(b)) - Number(comecaCom(a)))
            .slice(0, 8)
            .map(e => ({
                id: e.id,
                nomeTrechos: segmentarDestaque(e.nome_popular, consulta).map((t, k) => ({ ...t, k })),
                cienTrechos: segmentarDestaque(e.nome_cientifico ?? "", consulta).map((t, k) => ({ ...t, k }))
            }));
        this.state = { ...this.state, opcoes, semOpcoes: opcoes.length === 0, semAviso: !consulta || exatas.length > 0 || opcoes.length > 0 };
    }

    escolherOpcao(evento, escopo) {
        const campo = this._formulario.elements.especie;
        this._escolhida = this._especies.find(e => e.id === escopo.o.id) ?? null;
        campo.value = this._escolhida?.nome_popular ?? campo.value;
        // "input" para o botão Limpar aparecer; a escolha feita acima fecha a lista de opções.
        campo.dispatchEvent(new Event("input", { bubbles: true }));
        this._formulario.elements.quantidade.focus();
    }

    fechar() {
        this._dialogo?.close();
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

                const especie = dados.get("especie").trim();
        const chave = normalizarNome(especie);
        // A espécie escolhida na lista vale; senão, o nome só vincula se identifica uma espécie única.
        const porNome = this._especies.filter(e => normalizarNome(e.nome_popular) === chave);
        const doCatalogo = this._escolhida && normalizarNome(this._escolhida.nome_popular) === chave
            ? this._escolhida
            : (porNome.length === 1 ? porNome[0] : null);

        const detalhe = {
            especie,
            especieId: doCatalogo?.id ?? null,
            quantidade: dados.get("quantidade") ? Number(dados.get("quantidade")) : null,
            sementes: dados.get("sementes") ? Number(dados.get("sementes")) : null,
            observacao: dados.get("observacao").trim() || null,
            dataPlantio
        };

        // Editando uma planta já adicionada: grava por cima (o formulário é a verdade inteira).
        if (this._editandoId) {
            const id = this._editandoId;
            this._formulario.reset();
            this._definirFormularioAberto(false);
            this.dispatchEvent(new CustomEvent("planta-atualizada", { detail: { id, parcial: false, ...detalhe } }));
            return;
        }

        // Já tem essa espécie neste metro? Pode ser outro plantio (ex: no ano que vem, com outros dados):
        // quem decide é a pessoa.
        const igual = acharPlantaIgual(this._plantas ?? [], detalhe);
        if (igual) {
            this._pendente = { ...detalhe, existenteId: igual.id };
            const resumo = [
                igual.quantidade ? `${igual.quantidade} planta(s)` : "",
                igual.data_plantio ? descreverIdadePlantio(igual.data_plantio) : ""
            ].filter(Boolean).join(", ");
            this.state = {
                ...this.state,
                semConflito: false,
                conflitoAtivo: true,
                textoConflito: `Já existe "${igual.especie}" neste metro${resumo ? ` (${resumo})` : ""}. É uma planta nova (outro plantio) ou você quer atualizar a que já está?`
            };
            // O aviso fica no fim do formulário: em tela pequena estaria abaixo da dobra.
            requestAnimationFrame(() => this.querySelector(".aviso-conflito-planta").scrollIntoView({ block: "nearest" }));
            return;
        }

        this._formulario.reset();
        this._definirFormularioAberto(false);
        this.dispatchEvent(new CustomEvent("planta-adicionada", { detail: detalhe }));
    }
}

customElements.define("dialogo-planta-metro", DialogoPlantaMetro);
