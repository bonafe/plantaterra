import { plantaTerraDB } from "../db/plantaterra_db.js";
import { exportarBiblioteca, importarBiblioteca } from "../db/exportador_biblioteca.js";
import { CICLOS_ESPECIE, chaveEspecie, normalizarNome } from "../dominio/biblioteca_plantas.js";
import "./card_planta.js";
import "./campo_limpavel.js";

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
        const visiveis = this._especies.filter(e =>
            !termo || normalizarNome(`${e.nome_popular} ${e.nome_cientifico ?? ""}`).includes(termo));

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
        const itens = [
            ["Ciclo", especie.ciclo ? ROTULO_CICLO[especie.ciclo] : null],
            ["Espaçamento recomendado", especie.espacamento_recomendado_m ? `${especie.espacamento_recomendado_m.toLocaleString("pt-BR")} m` : null],
            ["Notas", especie.notas]
        ].filter(([, valor]) => valor);
        const lista = this.querySelector(".detalhe-lista");
        lista.replaceChildren(...itens.flatMap(([rotulo, valor]) => {
            const dt = document.createElement("dt");
            dt.textContent = rotulo;
            const dd = document.createElement("dd");
            dd.textContent = valor;
            return [dt, dd];
        }));
        this.dialogoDetalhe.showModal();
    }

    _abrirDialogo(especie) {
        this._especieEmEdicao = especie;
        this.formulario.reset();
        this.elementoErro.hidden = true;
        this.querySelector(".titulo-dialogo-especie").textContent = especie ? "Editar espécie" : "Nova espécie";
        if (especie) {
            this.formulario.nome_popular.value = especie.nome_popular;
            this.formulario.nome_cientifico.value = especie.nome_cientifico ?? "";
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
            notas: dados.get("notas").trim() || null
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
                notas: campos.notas
            });
        } else {
            await plantaTerraDB.criarEspecie(campos);
        }

        this.dialogo.close();
        await this._carregar();
    }
}

customElements.define("tela-biblioteca", TelaBiblioteca);
