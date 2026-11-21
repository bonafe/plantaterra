import "./componentes/lista_projetos.js";
import "./componentes/painel_projeto.js";
import "./componentes/tela_apoiar.js";
import "./componentes/tela_biblioteca.js";
import "./consentimento_analytics.js";
import { VERSAO_APP } from "./versao.js";
import { urlFeedbackWhatsApp } from "./feedback_whatsapp.js";
import { plantaTerraDB } from "./db/plantaterra_db.js";
import { DBBase } from "./db/db_base.js";
import { garantirArmazenamentoPersistente } from "./armazenamento.js";

const app = document.querySelector("#app");

document.querySelector(".rodape-versao").innerHTML = `
    <a href="#/apoiar">❤️ Apoiar</a>
    · <a href="${urlFeedbackWhatsApp()}" target="_blank" rel="noopener">💬 Relatar</a>
    · PlantaTerra v${VERSAO_APP}
`;

// Problemas de versão do banco entre abas: sem aviso, o app só pareceria vazio.
function mostrarAvisoBanco(mensagem, textoBotao, aoClicar) {
    document.querySelector(".aviso-banco")?.remove();
    const aviso = document.createElement("div");
    aviso.className = "aviso-banco";
    aviso.setAttribute("role", "alert");
    aviso.innerHTML = `<p></p><button type="button" class="botao-primario"></button>`;
    aviso.querySelector("p").textContent = mensagem;
    const botao = aviso.querySelector("button");
    botao.textContent = textoBotao;
    botao.addEventListener("click", aoClicar);
    document.body.appendChild(aviso);
}

plantaTerraDB.addEventListener(DBBase.EVENTO_BLOQUEADO, () => {
    mostrarAvisoBanco(
        "Seus dados estão seguros, mas o PlantaTerra não consegue abrir: há outra aba ou janela do app aberta numa versão antiga. Feche as outras e tente de novo.",
        "Tentar de novo",
        () => location.reload()
    );
});

plantaTerraDB.addEventListener(DBBase.EVENTO_VERSAO_ALTERADA, () => {
    mostrarAvisoBanco(
        "O PlantaTerra foi atualizado em outra aba. Recarregue esta página para continuar.",
        "Recarregar",
        () => location.reload()
    );
});

garantirArmazenamentoPersistente();

function renderizarRota() {
    const hash = location.hash || "#/";
    const correspondenciaProjeto = hash.match(/^#\/projeto\/(.+)$/);

    app.innerHTML = "";

    if (hash === "#/apoiar") {
        app.appendChild(document.createElement("tela-apoiar"));
    } else if (hash === "#/biblioteca") {
        app.appendChild(document.createElement("tela-biblioteca"));
    } else if (correspondenciaProjeto) {
        const painel = document.createElement("painel-projeto");
        painel.dataset.id = correspondenciaProjeto[1];
        app.appendChild(painel);
    } else {
        app.appendChild(document.createElement("lista-projetos"));
    }
}

window.addEventListener("hashchange", renderizarRota);
window.addEventListener("load", renderizarRota);

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(erro => {
            console.warn("Falha ao registrar service worker:", erro);
        });
    });
}
