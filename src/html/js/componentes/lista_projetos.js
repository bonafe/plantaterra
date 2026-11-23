import { plantaTerraDB } from "../db/plantaterra_db.js";
import { exportarBackup, importarArquivo } from "../db/exportador_projeto.js";
import { escaparHtml, formatarData } from "./util_dom.js";

/**
 * <lista-projetos>: tela inicial — criar, abrir, importar e excluir projetos.
 */
export class ListaProjetos extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <div class="tela-lista-projetos">
                <header class="cabecalho-app">
                    <div class="cabecalho-linha">
                        <a href="../../" class="botao-voltar" aria-label="Voltar para a página inicial">←</a>
                        <h1>PlantaTerra</h1>
                    </div>
                    <p class="subtitulo">Curva de nível e perímetro de propriedades</p>
                </header>

                <div class="acoes-lista-projetos">
                    <button type="button" data-acao="novo-projeto" class="botao-primario">+ Novo projeto</button>
                    <a href="#/biblioteca" class="botao-secundario">🌱 Biblioteca de plantas</a>
                    <button type="button" class="botao-secundario" data-acao="abrir-backup">⭳ Backup</button>
                    <label class="botao-secundario botao-arquivo">
                        ⭱ Importar
                        <input type="file" accept="application/json" data-acao="importar-arquivo" hidden />
                    </label>
                </div>

                <ul class="lista-projetos"></ul>

                <dialog class="dialogo-backup">
                    <form method="dialog" class="formulario-backup">
                        <h2>Backup</h2>
                        <p class="ajuda-campo">Escolha o que vai para o arquivo. Ele guarda tudo: perímetros, estações e leituras, SAF, linhas e plantas — e a ficha das espécies que cada projeto usa (com a foto de capa), para o projeto abrir completo em outro aparelho.</p>
                        <div class="backup-cabecalho-projetos">
                            <strong>Projetos</strong>
                            <button type="button" class="botao-icone-inline" data-acao="alternar-todos-backup">Marcar/desmarcar todos</button>
                        </div>
                        <div class="backup-lista-projetos"></div>
                        <div class="acoes-formulario">
                            <button type="submit" value="baixar" class="botao-primario" data-acao="baixar-backup">Baixar backup</button>
                            <button type="button" data-acao="cancelar-backup">Cancelar</button>
                        </div>
                    </form>
                </dialog>

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

        this._wireBackup();

        this.querySelector('[data-acao="importar-arquivo"]').addEventListener("change", async evento => {
            const arquivo = evento.target.files[0];
            if (!arquivo) return;
            try {
                const { projetos, biblioteca } = await importarArquivo(arquivo);
                if (projetos.length === 1 && !biblioteca) {
                    location.hash = `#/projeto/${projetos[0].id}`;
                } else {
                    const partes = [];
                    if (projetos.length) partes.push(`${projetos.length} projeto(s)`);
                    if (biblioteca) {
                        partes.push(`biblioteca: ${biblioteca.adicionadas} ficha(s) adicionada(s)` +
                            (biblioteca.atualizadas ? `, ${biblioteca.atualizadas} atualizada(s)` : "") +
                            (biblioteca.preservadas ? `, ${biblioteca.preservadas} editada(s) por você mantida(s)` : ""));
                    }
                    alert(`Importação concluída: ${partes.join(" · ")}.`);
                    await this.carregar();
                }
            } catch (erro) {
                alert(`Não foi possível importar o arquivo: ${erro.message}`);
            } finally {
                evento.target.value = "";
            }
        });

        this.carregar();
    }

    _wireBackup() {
        const dialogo = this.querySelector(".dialogo-backup");
        const formulario = this.querySelector(".formulario-backup");
        const listaProjetos = this.querySelector(".backup-lista-projetos");
        const botaoBaixar = this.querySelector('[data-acao="baixar-backup"]');

        const checkboxesProjetos = () => [...listaProjetos.querySelectorAll('input[type="checkbox"]')];
        const atualizarBotao = () => {
            botaoBaixar.disabled = !checkboxesProjetos().some(c => c.checked);
        };

        this.querySelector('[data-acao="abrir-backup"]').addEventListener("click", async () => {
            const projetos = await plantaTerraDB.listarProjetos();

            listaProjetos.innerHTML = projetos.length === 0
                ? `<p class="ajuda-campo">Nenhum projeto ainda.</p>`
                : projetos.map(projeto => `
                    <label class="campo-checkbox">
                        <input type="checkbox" value="${projeto.id}" checked />
                        <span>${escaparHtml(projeto.nome)}</span>
                    </label>
                `).join("");

            atualizarBotao();
            dialogo.showModal();
        });

        this.querySelector('[data-acao="alternar-todos-backup"]').addEventListener("click", () => {
            const caixas = checkboxesProjetos();
            const marcar = caixas.some(c => !c.checked);
            caixas.forEach(c => { c.checked = marcar; });
            atualizarBotao();
        });

        formulario.addEventListener("change", atualizarBotao);
        this.querySelector('[data-acao="cancelar-backup"]').addEventListener("click", () => dialogo.close());

        formulario.addEventListener("submit", async evento => {
            if (evento.submitter?.value !== "baixar") return;
            evento.preventDefault();
            const projetoIds = checkboxesProjetos().filter(c => c.checked).map(c => c.value);
            try {
                await exportarBackup({ projetoIds });
                dialogo.close();
            } catch (erro) {
                alert(`Não foi possível gerar o backup: ${erro.message}`);
            }
        });
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
