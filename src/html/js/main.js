import "./componentes/lista_projetos.js";
import "./componentes/painel_projeto.js";
import { VERSAO_APP } from "./versao.js";

const app = document.querySelector("#app");

document.querySelector(".rodape-versao").textContent = `PlantaTerra v${VERSAO_APP}`;

function renderizarRota() {
    const hash = location.hash || "#/";
    const correspondenciaProjeto = hash.match(/^#\/projeto\/(.+)$/);

    app.innerHTML = "";

    if (correspondenciaProjeto) {
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
