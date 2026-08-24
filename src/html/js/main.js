import "./componentes/lista_projetos.js";
import "./componentes/painel_projeto.js";
import "./componentes/tela_apoiar.js";
import "./consentimento_analytics.js";
import { VERSAO_APP } from "./versao.js";
import { urlFeedbackWhatsApp } from "./feedback_whatsapp.js";

const app = document.querySelector("#app");

document.querySelector(".rodape-versao").innerHTML = `
    <a href="#/apoiar">❤️ Apoiar</a>
    · <a href="${urlFeedbackWhatsApp()}" target="_blank" rel="noopener">💬 Relatar</a>
    · PlantaTerra v${VERSAO_APP}
`;

function renderizarRota() {
    const hash = location.hash || "#/";
    const correspondenciaProjeto = hash.match(/^#\/projeto\/(.+)$/);

    app.innerHTML = "";

    if (hash === "#/apoiar") {
        app.appendChild(document.createElement("tela-apoiar"));
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
