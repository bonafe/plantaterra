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
    · <a href="#" data-acao="mostrar-qr">📱 QR</a>
    · PlantaTerra v${VERSAO_APP}
`;

// QR code do endereço do app, para abrir no celular sem digitar a URL.
document.querySelector('[data-acao="mostrar-qr"]').addEventListener("click", evento => {
    evento.preventDefault();
    const url = location.origin + location.pathname;
    const dialogo = document.createElement("dialog");
    dialogo.className = "dialogo-qr";
    dialogo.innerHTML = `
        <h2>Abrir no celular</h2>
        <p class="ajuda-campo">Aponte a câmera do celular para o código.</p>
        <div class="qr-imagem"></div>
        <p class="qr-url"></p>
        <p class="ajuda-campo qr-aviso" hidden>Este endereço é do próprio computador (localhost): o celular não vai conseguir abri-lo. Abra o app pelo IP da rede (ex: http://192.168.x.x:8080/src/html/).</p>
        <div class="acoes-formulario"><button type="button" data-acao="fechar-qr">Fechar</button></div>
    `;
    dialogo.querySelector(".qr-url").textContent = url;
    dialogo.querySelector(".qr-aviso").hidden = !/^(localhost|127\.|\[::1\])/.test(location.hostname);
    new QRCode(dialogo.querySelector(".qr-imagem"), { text: url, width: 220, height: 220 });
    dialogo.querySelector('[data-acao="fechar-qr"]').addEventListener("click", () => dialogo.close());
    dialogo.addEventListener("close", () => dialogo.remove());
    document.body.appendChild(dialogo);
    dialogo.showModal();
});

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

// Ao abrir o app (não a cada volta à lista), vai direto ao último lugar onde a pessoa estava.
function reabrirUltimoLugar() {
    if (location.hash && location.hash !== "#/") return;
    try {
        const lugar = JSON.parse(localStorage.getItem("plantaterra:ultimo-lugar"));
        if (lugar?.projetoId) location.hash = `#/projeto/${lugar.projetoId}`;
    } catch { /* sem armazenamento: abre a lista normalmente */ }
}
reabrirUltimoLugar();

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
