/**
 * Armazenamento persistente (ver docs/especificacao.md secao 10): sem ele o
 * navegador pode apagar o IndexedDB do app quando faltar espaço ou, no iOS
 * Safari, após ~7 dias sem uso — e como todo dado do usuário só existe no
 * aparelho, isso seria perda definitiva. Pedir persistência é só uma
 * solicitação: o navegador decide (Chrome/Safari costumam conceder sozinhos
 * para app instalado ou de uso frequente; Firefox pergunta ao usuário).
 */

/**
 * Pede armazenamento persistente se ainda não houver. Seguro de chamar várias
 * vezes. Retorna true/false se o navegador respondeu, ou null se não há suporte.
 */
export async function garantirArmazenamentoPersistente() {
    if (!navigator.storage?.persist || !navigator.storage?.persisted) return null;

    try {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
    } catch (erro) {
        console.warn("Não foi possível pedir armazenamento persistente:", erro);
        return null;
    }
}
