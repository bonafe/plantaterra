import { plantaTerraDB } from "../db/plantaterra_db.js";
import { importarProjeto } from "../db/exportador_projeto.js";
import { escaparHtml, formatarData } from "./util_dom.js";

/**
 * <lista-projetos>: tela inicial — criar, abrir, importar e excluir projetos.
 */
export class ListaProjetos extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <div class="tela-lista-projetos">
                <header class="cabecalho-app">
                    <h1>PlantaTerra</h1>
                    <p class="subtitulo">Curva de nível e perímetro de propriedades</p>
                </header>

                <div class="acoes-lista-projetos">
                    <button type="button" data-acao="novo-projeto" class="botao-primario">+ Novo projeto</button>
                    <label class="botao-secundario botao-arquivo">
                        Importar projeto
                        <input type="file" accept="application/json" data-acao="importar-arquivo" hidden />
                    </label>
                </div>

                <ul class="lista-projetos"></ul>

                <dialog class="dialogo-novo-projeto">
                    <form method="dialog" class="formulario-novo-projeto">
                        <h2>Novo projeto</h2>
                        <label>Nome da propriedade
                            <input type="text" name="nome" required maxlength="120" />
                        </label>
                        <label>Descrição (opcional)
                            <textarea name="descricao" maxlength="500"></textarea>
                        </label>
                        <div class="acoes-formulario">
                            <button type="submit" value="criar" class="botao-primario">Criar</button>
                            <button type="button" data-acao="cancelar-novo-projeto">Cancelar</button>
                        </div>
                    </form>
                </dialog>
            </div>
        `;

        this.listaElemento = this.querySelector(".lista-projetos");
        this.dialogoNovoProjeto = this.querySelector(".dialogo-novo-projeto");
        this.formularioNovoProjeto = this.querySelector(".formulario-novo-projeto");

        this.querySelector('[data-acao="novo-projeto"]').addEventListener("click", () => {
            this.formularioNovoProjeto.reset();
            this.dialogoNovoProjeto.showModal();
        });

        this.querySelector('[data-acao="cancelar-novo-projeto"]').addEventListener("click", () => {
            this.dialogoNovoProjeto.close();
        });

        this.formularioNovoProjeto.addEventListener("submit", async evento => {
            if (evento.submitter?.value !== "criar") return;
            const dados = new FormData(this.formularioNovoProjeto);
            const projeto = await plantaTerraDB.criarProjeto({
                nome: dados.get("nome").trim(),
                descricao: dados.get("descricao").trim()
            });
            location.hash = `#/projeto/${projeto.id}`;
        });

        this.querySelector('[data-acao="importar-arquivo"]').addEventListener("change", async evento => {
            const arquivo = evento.target.files[0];
            if (!arquivo) return;
            try {
                const projeto = await importarProjeto(arquivo);
                location.hash = `#/projeto/${projeto.id}`;
            } catch (erro) {
                alert(`Não foi possível importar o arquivo: ${erro.message}`);
            } finally {
                evento.target.value = "";
            }
        });

        this.carregar();
    }

    async carregar() {
        const projetos = await plantaTerraDB.listarProjetos();

        if (projetos.length === 0) {
            this.listaElemento.innerHTML = `<li class="lista-vazia">Nenhum projeto ainda. Crie o primeiro acima.</li>`;
            return;
        }

        this.listaElemento.innerHTML = projetos.map(projeto => `
            <li class="item-projeto" data-id="${projeto.id}">
                <a href="#/projeto/${projeto.id}" class="item-projeto-link">
                    <strong>${escaparHtml(projeto.nome)}</strong>
                    <span class="item-projeto-descricao">${escaparHtml(projeto.descricao || "")}</span>
                    <span class="item-projeto-data">Atualizado em ${formatarData(projeto.atualizado_em)}</span>
                </a>
                <button type="button" class="botao-excluir" data-acao="excluir" aria-label="Excluir projeto">🗑</button>
            </li>
        `).join("");

        this.listaElemento.querySelectorAll('[data-acao="excluir"]').forEach(botao => {
            botao.addEventListener("click", async evento => {
                const id = evento.target.closest(".item-projeto").dataset.id;
                if (confirm("Excluir este projeto e todos os seus dados? Essa ação não pode ser desfeita.")) {
                    await plantaTerraDB.excluirProjeto(id);
                    this.carregar();
                }
            });
        });
    }
}

customElements.define("lista-projetos", ListaProjetos);
