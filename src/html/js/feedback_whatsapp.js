/**
 * Feedback direto por WhatsApp — sem backend, sem formulário: abre o
 * WhatsApp com uma mensagem pré-preenchida (`wa.me/<numero>?text=...`),
 * que a pessoa revisa/completa antes de enviar.
 */

// TODO: número real de WhatsApp para receber feedback ainda não configurado
// — trocar antes de divulgar. Formato E.164 sem "+"/espaços/traços
// (exigido por wa.me), ex.: "5511999999999".
export const NUMERO_WHATSAPP_FEEDBACK = "5500000000000"; // TODO: configurar

export function construirMensagemFeedback() {
    return [
        "Feedback sobre o PlantaTerra",
        "",
        "Descreva aqui o que você notou, sugere ou gostaria que funcionasse diferente:",
        ""
    ].join("\n");
}

/** URL pronta pra um link `<a>` (mais robusto que abrir via JS: funciona com toque longo/menu de contexto no celular). */
export function urlFeedbackWhatsApp() {
    return `https://wa.me/${NUMERO_WHATSAPP_FEEDBACK}?text=${encodeURIComponent(construirMensagemFeedback())}`;
}
