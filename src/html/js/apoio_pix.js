import { OPCOES_PIX } from "./dados_apoio.js";

/**
 * Painel de apoio via Pix (ver docs/especificacao.md secao 11.1) — só exibe
 * as strings "Pix copia e cola" já prontas (`dados_apoio.js`), nunca
 * constrói/calcula payload aqui. Compartilhado entre `<tela-apoiar>` (dentro
 * do app) e a landing page na raiz do repositório, pra não duplicar a lógica
 * do QR Code/cópia em dois lugares.
 */
export function markupPainelPix() {
    return `
        <div class="pix-painel">
            <div class="pix-valores"></div>
            <div class="pix-qr" hidden></div>
            <button type="button" class="botao-primario pix-copiar" hidden>Copiar código Pix</button>
            <input type="text" class="pix-copia-manual" readonly hidden />
            <p class="pix-indisponivel" hidden>
                Chave Pix ainda sendo configurada — volte em breve.
            </p>
        </div>
    `;
}

/** `raizEl` precisa conter o markup de `markupPainelPix()` (direto ou descendente). */
export function montarPainelPix(raizEl) {
    const valoresEl = raizEl.querySelector(".pix-valores");
    const qrEl = raizEl.querySelector(".pix-qr");
    const copiarBtnEl = raizEl.querySelector(".pix-copiar");
    const copiaManualEl = raizEl.querySelector(".pix-copia-manual");
    const indisponivelEl = raizEl.querySelector(".pix-indisponivel");

    const opcoesDisponiveis = OPCOES_PIX.filter(opcao => opcao.payload);

    if (opcoesDisponiveis.length === 0) {
        indisponivelEl.hidden = false;
        return;
    }

    let qrcode = null;
    let payloadAtual = null;

    const rotuloValor = opcao => (opcao.valor == null ? "Valor livre" : `R$ ${opcao.valor}`);

    const selecionarOpcao = opcao => {
        payloadAtual = opcao.payload;
        copiaManualEl.hidden = true;

        valoresEl.querySelectorAll(".pix-valor-btn").forEach(botao => {
            botao.classList.toggle("ativo", botao.dataset.payload === opcao.payload);
        });

        if (qrcode) {
            qrcode.clear();
            qrcode.makeCode(payloadAtual);
        } else {
            qrcode = new QRCode(qrEl, { text: payloadAtual, width: 200, height: 200 });
        }
    };

    const mostrarCopiado = () => {
        const textoOriginal = copiarBtnEl.textContent;
        copiarBtnEl.textContent = "Copiado!";
        setTimeout(() => { copiarBtnEl.textContent = textoOriginal; }, 2000);
    };

    // Fallback pro Safari/iOS, que em vários contextos rejeita a Clipboard
    // API mesmo dentro de um clique — nunca falha silenciosamente.
    const mostrarCopiaManual = () => {
        copiaManualEl.hidden = false;
        copiaManualEl.value = payloadAtual;
        copiaManualEl.focus();
        copiaManualEl.select();
        copiaManualEl.setSelectionRange(0, payloadAtual.length);
    };

    copiarBtnEl.addEventListener("click", () => {
        if (!payloadAtual) return;
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(payloadAtual).then(mostrarCopiado, mostrarCopiaManual);
        } else {
            mostrarCopiaManual();
        }
    });

    opcoesDisponiveis.forEach((opcao, indice) => {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "pix-valor-btn";
        botao.textContent = rotuloValor(opcao);
        botao.dataset.payload = opcao.payload;
        botao.addEventListener("click", () => selecionarOpcao(opcao));
        valoresEl.appendChild(botao);

        if (indice === 0) selecionarOpcao(opcao);
    });

    valoresEl.hidden = opcoesDisponiveis.length <= 1;
    qrEl.hidden = false;
    copiarBtnEl.hidden = false;
}
