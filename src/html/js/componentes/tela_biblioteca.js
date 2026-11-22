import { plantaTerraDB } from "../db/plantaterra_db.js";
import { exportarBiblioteca, importarBiblioteca } from "../db/exportador_biblioteca.js";
import { CICLOS_ESPECIE, chaveEspecie, nomesDaEspecie, normalizarNome, textosDeBusca } from "../dominio/biblioteca_plantas.js";
import { ESTADOS_BRASIL } from "../dominio/estados_brasil.js";
import "./card_planta.js";
import "./campo_limpavel.js";

/** Outro nome popular (que não o principal) em que a busca bateu, se for o caso. */
function aliasEncontrado(especie, termo) {
    if (!termo || normalizarNome(especie.nome_popular).includes(termo)) return null;
    return nomesDaEspecie(especie).find(nome => normalizarNome(nome).includes(termo)) ?? null;
}

const NOMES_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** { min, max } → "60 a 90 cm" (ou só um lado); null se vazio. */
function textoDeFaixa(faixa, unidade) {
    if (!faixa || (faixa.min == null && faixa.max == null)) return null;
    const numeros = faixa.min != null && faixa.max != null && faixa.min !== faixa.max
        ? `${faixa.min} a ${faixa.max}` : `${faixa.min ?? faixa.max}`;
    return `${numeros} ${unidade}`;
}

const humanizar = chave => chave.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());

const ROTULO_CICLO = { anual: "Anual", bienal: "Bienal", perene: "Perene" };

/**
 * <tela-biblioteca>: catálogo global de espécies (ver docs/especificacao.md
 * secao 15.1). Não pertence a um projeto — é reaproveitado por todos.
 */
export class TelaBiblioteca extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <div class="tela-biblioteca">
                <header class="cabecalho-app cabecalho-projeto">
                    <button type="button" class="botao-voltar" data-acao="voltar" aria-label="Voltar">←</button>
                    <nav class="migalhas" aria-label="Você está em">
                        <a href="#/" class="migalha">PlantaTerra</a><span class="migalha-separador" aria-hidden="true">/</span>
                        <h1 class="migalha migalha-atual" aria-current="page">Biblioteca</h1>
                    </nav>
                </header>

                <div class="painel-biblioteca">
                    <div class="acoes-lista-projetos">
                        <button type="button" class="botao-primario" data-acao="nova-especie">+ Nova espécie</button>
                        <button type="button" class="botao-secundario" data-acao="exportar">Exportar</button>
                        <label class="botao-secundario botao-arquivo">
                            Importar
                            <input type="file" accept="application/json" data-acao="importar" hidden />
                        </label>
                    </div>

                    <campo-limpavel class="busca-biblioteca-caixa">
                        <input type="search" class="busca-biblioteca" placeholder="Buscar espécie…" aria-label="Buscar espécie" />
                    </campo-limpavel>
                    <ul class="lista-especies"></ul>
                </div>

                <dialog class="dialogo-detalhe-especie">
                    <h2 class="detalhe-nome"></h2>
                    <p class="detalhe-cientifico"></p>
                    <dl class="detalhe-lista"></dl>
                    <div class="detalhe-extras"></div>
                    <div class="acoes-formulario">
                        <button type="button" class="botao-primario" data-acao="editar-detalhe">Editar</button>
                        <button type="button" data-acao="remover-detalhe">Remover</button>
                        <button type="button" data-acao="fechar-detalhe">Fechar</button>
                    </div>
                </dialog>

                <dialog class="dialogo-especie">
                    <form method="dialog" class="formulario-especie">
                        <h2 class="titulo-dialogo-especie"></h2>
                        <label>Nome popular
                            <input type="text" name="nome_popular" required maxlength="80" />
                        </label>
                        <label>Nome científico (opcional)
                            <input type="text" name="nome_cientifico" maxlength="120" />
                        </label>
                        <label>Outros nomes populares (opcional, separados por vírgula)
                            <input type="text" name="outros_nomes" maxlength="300" />
                        </label>
                        <label>Ciclo (opcional)
                            <select name="ciclo">
                                <option value="">—</option>
                                ${CICLOS_ESPECIE.map(c => `<option value="${c}">${ROTULO_CICLO[c]}</option>`).join("")}
                            </select>
                        </label>
                        <label>Espaçamento recomendado em metros (opcional)
                            <input type="number" name="espacamento" min="0.1" step="0.1" inputmode="decimal" />
                        </label>
                        <label>Notas (opcional)
                            <textarea name="notas" maxlength="500"></textarea>
                        </label>
                        <p class="erro-formulario" hidden></p>
                        <div class="acoes-formulario">
                            <button type="submit" value="salvar" class="botao-primario">Salvar</button>
                            <button type="button" data-acao="cancelar-especie">Cancelar</button>
                        </div>
                    </form>
                </dialog>
            </div>
        `;

        this.listaElemento = this.querySelector(".lista-especies");
        this.campoBusca = this.querySelector(".busca-biblioteca");
        this.dialogo = this.querySelector(".dialogo-especie");
        this.dialogoDetalhe = this.querySelector(".dialogo-detalhe-especie");
        this.formulario = this.querySelector(".formulario-especie");
        this.elementoErro = this.querySelector(".erro-formulario");
        this._especies = [];
        this._especieEmEdicao = null;

        this.querySelector('[data-acao="voltar"]').addEventListener("click", () => {
            // Abrir a tela direto pela URL não deixa histórico para voltar.
            if (history.length > 1) history.back(); else location.hash = "#/";
        });

        this.querySelector('[data-acao="nova-especie"]').addEventListener("click", () => this._abrirDialogo(null));
        this.querySelector('[data-acao="cancelar-especie"]').addEventListener("click", () => this.dialogo.close());
        this.campoBusca.addEventListener("input", () => this._renderizarLista());
        this.formulario.addEventListener("submit", evento => this._aoSalvar(evento));

        this.querySelector('[data-acao="exportar"]').addEventListener("click", async () => {
            if (this._especies.length === 0) {
                alert("A biblioteca está vazia — não há nada para exportar.");
                return;
            }
            await exportarBiblioteca();
        });

        this.querySelector('[data-acao="importar"]').addEventListener("change", async evento => {
            const arquivo = evento.target.files[0];
            if (!arquivo) return;
            try {
                const { adicionadas, jaExistentes, invalidas } = await importarBiblioteca(arquivo);
                const partes = [`${adicionadas} adicionada(s)`];
                if (jaExistentes) partes.push(`${jaExistentes} já existia(m) e foi(ram) mantida(s)`);
                if (invalidas) partes.push(`${invalidas} ignorada(s) por falta de nome`);
                alert(`Importação concluída: ${partes.join(", ")}.`);
                await this._carregar();
            } catch (erro) {
                alert(`Não foi possível importar o arquivo: ${erro.message}`);
            } finally {
                evento.target.value = "";
            }
        });

        // Tocar no card abre o detalhe; editar e remover ficam lá (não se edita toda hora).
        this.listaElemento.addEventListener("acao-card", evento => {
            const id = evento.target.closest(".item-card").dataset.id;
            const especie = this._especies.find(e => e.id === id);
            if (especie && evento.detail.acao === "abrir") this._abrirDetalhe(especie);
        });

        this.querySelector('[data-acao="fechar-detalhe"]').addEventListener("click", () => this.dialogoDetalhe.close());
        this.querySelector('[data-acao="editar-detalhe"]').addEventListener("click", () => {
            this.dialogoDetalhe.close();
            this._abrirDialogo(this._especieDetalhe);
        });
        this.querySelector('[data-acao="remover-detalhe"]').addEventListener("click", async () => {
            const especie = this._especieDetalhe;
            if (!confirm(`Excluir "${especie.nome_popular}" da biblioteca? Plantas já cadastradas em linhas continuam com o nome.`)) return;
            this.dialogoDetalhe.close();
            await plantaTerraDB.removerEspecie(especie.id);
            await this._carregar();
        });

        this._carregar();
    }

    async _carregar() {
        this._especies = await plantaTerraDB.listarEspecies();
        this._renderizarLista();
    }

    _renderizarLista() {
        const termo = normalizarNome(this.campoBusca.value);
        // Procura em todos os nomes populares, no nome científico e nos sinônimos.
        const visiveis = this._especies.filter(e =>
            !termo || textosDeBusca(e).some(texto => normalizarNome(texto).includes(termo)));

        if (this._especies.length === 0) {
            this.listaElemento.innerHTML = `<li class="lista-vazia">Nenhuma espécie ainda. Cadastre a primeira ou importe um catálogo.</li>`;
            return;
        }
        if (visiveis.length === 0) {
            this.listaElemento.innerHTML = `<li class="lista-vazia">Nenhuma espécie encontrada para essa busca.</li>`;
            return;
        }

        this.listaElemento.replaceChildren(...visiveis.map(especie => {
            const item = document.createElement("li");
            item.className = "item-card";
            item.dataset.id = especie.id;
            const card = document.createElement("card-planta");
            card.dados = {
                nome: especie.nome_popular,
                cientifico: especie.nome_cientifico ?? "",
                linhas: [
                    // Achou por outro nome popular? Mostra qual.
                    aliasEncontrado(especie, termo) ? `também: ${aliasEncontrado(especie, termo)}` : "",
                    [especie.familia, especie.forma_de_vida].filter(Boolean).join(" · "),
                    [especie.ciclo ? ROTULO_CICLO[especie.ciclo] : null,
                        especie.espacamento_recomendado_m ? `espaçamento ${especie.espacamento_recomendado_m.toLocaleString("pt-BR")} m` : null]
                        .filter(Boolean).join(" · "),
                    especie.notas ?? ""
                ],
                clicavel: true,
                destaque: this.campoBusca.value
            };
            item.appendChild(card);
            return item;
        }));
    }

    _abrirDetalhe(especie) {
        this._especieDetalhe = especie;
        this.querySelector(".detalhe-nome").textContent = especie.nome_popular;
        this.querySelector(".detalhe-cientifico").innerHTML = "";
        if (especie.nome_cientifico) {
            const em = document.createElement("em");
            em.textContent = especie.nome_cientifico;
            this.querySelector(".detalhe-cientifico").append(em);
        }
        const altura = especie.altura_min_m && especie.altura_max_m
            ? (especie.altura_min_m === especie.altura_max_m ? `${especie.altura_min_m} m` : `${especie.altura_min_m} a ${especie.altura_max_m} m`)
            : (especie.altura_max_m ?? especie.altura_min_m ? `${especie.altura_max_m ?? especie.altura_min_m} m` : null);
        const estados = (especie.ocorrencia_estados ?? [])
            .map(uf => ESTADOS_BRASIL.find(e => e.uf === uf)?.nome ?? uf).join(", ");
        const lista = (valores) => (valores?.length ? valores.join(", ") : null);
        const itens = [
            ["Outros nomes populares", lista(nomesDaEspecie(especie).slice(1))],
            ["Família", especie.familia],
            ["Autoria", especie.autoria],
            ["Sinônimos", lista(especie.sinonimos)],
            ["Origem", especie.origem],
            ["Forma de vida", especie.forma_de_vida],
            ["Altura", altura],
            ["Estrato sugerido no SAF", especie.estrato_saf],
            ["Exigência de luz", especie.exigencia_luminosa],
            ["Funções no SAF", lista(especie.funcoes?.map(f => f.replaceAll("_", " ")))],
            ["Partes utilizadas", lista(especie.partes_utilizadas)],
            ["Usos", lista(especie.usos)],
            ["Ciclo", especie.ciclo ? ROTULO_CICLO[especie.ciclo] : null],
            ["Espaçamento recomendado", especie.espacamento_recomendado_m ? `${especie.espacamento_recomendado_m.toLocaleString("pt-BR")} m` : null],
            ["Observação sobre a altura", especie.altura_observacao],
            ["Diâmetro do tronco", textoDeFaixa(especie.diametro_tronco_cm, "cm")],
            ["Densidade da madeira", especie.densidade_madeira_g_cm3 ? `${especie.densidade_madeira_g_cm3.toLocaleString("pt-BR")} g/cm³` : null],
            ["Floração", especie.floracao_meses?.length ? especie.floracao_meses.map(m => NOMES_MESES[m - 1]).join(", ") : null],
            ["Frutificação", especie.frutificacao_meses?.length ? especie.frutificacao_meses.map(m => NOMES_MESES[m - 1]).join(", ") : null],
            ["Sementes por kg (aprox.)", especie.sementes_por_kg ? especie.sementes_por_kg.toLocaleString("pt-BR") : null],
            ["Viabilidade das sementes armazenadas", especie.viabilidade_sementes ? `${especie.viabilidade_sementes} meses` : null],
            ["Taxa de germinação", especie.taxa_germinacao],
            ["Emergência das plântulas", textoDeFaixa(especie.emergencia_dias, "dias")],
            ["Germinação", textoDeFaixa(especie.germinacao_meses, "meses")],
            ["Mudas prontas em", textoDeFaixa(especie.mudas_prontas_meses, "meses")],
            ["Atenção à conservação", especie.advertencia_conservacao],
            ["Subfamília", especie.subfamilia],
            ["Taxonomia alternativa", especie.taxonomia_alternativa],
            ["Exsicata / referência botânica", especie.referencia_botanica],
            ["Ocorrência", especie.ocorrencia_texto],
            ["Precisão da ocorrência", especie.ocorrencia_precisao],
            ["Estados citados", estados || null],
            ["Notas", especie.notas],
            ["Fonte no livro", especie.fonte_primaria
                ? [especie.fonte_primaria.pagina ? `página ${especie.fonte_primaria.pagina}` : null, especie.fonte_primaria.titulo_da_obra, especie.fonte_primaria.nota].filter(Boolean).join(" — ")
                : null],
            // Dados que o catálogo trouxe e o app ainda não conhece: aparecem como vieram.
            ...Object.entries(especie.extras ?? {}).map(([chave, valor]) =>
                [humanizar(chave.split(".").pop()), typeof valor === "string" ? valor : JSON.stringify(valor)])
        ].filter(([, valor]) => valor);
        const listaElemento = this.querySelector(".detalhe-lista");
        listaElemento.replaceChildren(...itens.flatMap(([rotulo, valor]) => {
            const dt = document.createElement("dt");
            dt.textContent = rotulo;
            const dd = document.createElement("dd");
            dd.textContent = valor;
            return [dt, dd];
        }));

        // Descrições longas ficam recolhidas, para o detalhe não virar uma parede de texto.
        const ROTULO_SECAO = { morfologia: "Características", madeira: "Madeira", utilidade: "Utilidade", ecologia: "Ecologia",
            fenologia: "Floração e frutificação", sementes: "Obtenção de sementes", mudas: "Produção de mudas" };
        // Seções conhecidas primeiro; qualquer outra que o catálogo traga vem depois, com o nome que veio.
        const chavesSecao = [...Object.keys(ROTULO_SECAO), ...Object.keys(especie.detalhes ?? {}).filter(c => !(c in ROTULO_SECAO))];
        const secoes = chavesSecao.filter(chave => especie.detalhes?.[chave]).map(chave => {
            const detalhes = document.createElement("details");
            const resumo = document.createElement("summary");
            resumo.textContent = ROTULO_SECAO[chave] ?? humanizar(chave);
            const texto = document.createElement("p");
            texto.textContent = especie.detalhes[chave];
            detalhes.append(resumo, texto);
            return detalhes;
        });
        const extras = this.querySelector(".detalhe-extras");
        extras.replaceChildren(...secoes);
        if (especie.fontes?.length) {
            const paragrafo = document.createElement("p");
            paragrafo.className = "detalhe-fontes";
            paragrafo.append("Fontes: ");
            especie.fontes.forEach((url, i) => {
                const link = document.createElement("a");
                link.href = url;
                link.target = "_blank";
                link.rel = "noopener";
                link.textContent = url.replace(/^https?:\/\//, "").slice(0, 60);
                if (i) paragrafo.append(" · ");
                paragrafo.append(link);
            });
            extras.append(paragrafo);
        }
        this.dialogoDetalhe.showModal();
        this.dialogoDetalhe.scrollTop = 0;
    }

    _abrirDialogo(especie) {
        this._especieEmEdicao = especie;
        this.formulario.reset();
        this.elementoErro.hidden = true;
        this.querySelector(".titulo-dialogo-especie").textContent = especie ? "Editar espécie" : "Nova espécie";
        if (especie) {
            this.formulario.nome_popular.value = especie.nome_popular;
            this.formulario.nome_cientifico.value = especie.nome_cientifico ?? "";
            this.formulario.outros_nomes.value = nomesDaEspecie(especie).slice(1).join(", ");
            this.formulario.ciclo.value = especie.ciclo ?? "";
            this.formulario.espacamento.value = especie.espacamento_recomendado_m ?? "";
            this.formulario.notas.value = especie.notas ?? "";
        }
        this.dialogo.showModal();
    }

    async _aoSalvar(evento) {
        if (evento.submitter?.value !== "salvar") return;
        // method="dialog" fecharia o diálogo antes da validação de duplicidade.
        evento.preventDefault();

        const dados = new FormData(this.formulario);
        const nomePopular = dados.get("nome_popular").trim();
        const espacamento = dados.get("espacamento") ? Number(dados.get("espacamento")) : null;
        const campos = {
            nomePopular,
            nomeCientifico: dados.get("nome_cientifico").trim() || null,
            ciclo: dados.get("ciclo") || null,
            espacamentoRecomendadoM: espacamento,
            notas: dados.get("notas").trim() || null,
            // O nome principal é sempre o primeiro; os outros vêm do campo "outros nomes", sem repetir.
            nomes_populares: [...new Set([nomePopular, ...dados.get("outros_nomes").split(",").map(n => n.trim()).filter(Boolean)])]
        };

        // O mesmo nome popular pode ser de espécies diferentes: só repetir popular E científico é duplicata.
        const duplicada = this._especies.find(e =>
            e.id !== this._especieEmEdicao?.id && chaveEspecie(e.nome_popular, e.nome_cientifico) === chaveEspecie(nomePopular, campos.nomeCientifico));
        if (duplicada) {
            this.elementoErro.textContent = `Já existe "${duplicada.nome_popular}"${duplicada.nome_cientifico ? ` (${duplicada.nome_cientifico})` : ""} na biblioteca.`;
            this.elementoErro.hidden = false;
            return;
        }

        if (this._especieEmEdicao) {
            await plantaTerraDB.atualizarEspecie({
                ...this._especieEmEdicao,
                nome_popular: campos.nomePopular,
                nome_cientifico: campos.nomeCientifico,
                ciclo: campos.ciclo,
                espacamento_recomendado_m: campos.espacamentoRecomendadoM,
                notas: campos.notas,
                nomes_populares: campos.nomes_populares
            });
        } else {
            await plantaTerraDB.criarEspecie(campos);
        }

        this.dialogo.close();
        await this._carregar();
    }
}

customElements.define("tela-biblioteca", TelaBiblioteca);
