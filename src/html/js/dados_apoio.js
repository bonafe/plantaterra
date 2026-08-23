/**
 * Strings "Pix copia e cola" já prontas, geradas no app do banco/PSP —
 * nunca construídas ou calculadas aqui (um payload Pix errado falha na
 * validação do banco de quem for pagar, não é algo pra reinventar).
 * `valor: null` é a opção "valor livre"; `payload: null` esconde aquela
 * opção até existir a string real.
 *
 * TODO: preencher com as strings reais antes de divulgar o link de apoio —
 * gere cada uma no app do seu banco/PSP (Pix "copia e cola" com valor fixo,
 * uma por opção abaixo, mais uma sem valor pra "valor livre").
 */
export const OPCOES_PIX = [
    { valor: 5, payload: null },
    { valor: 10, payload: null },
    { valor: 25, payload: null },
    { valor: null, payload: null }
];
