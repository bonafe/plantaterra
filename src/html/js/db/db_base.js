/**
 * Wrapper Promise-based mínimo sobre IndexedDB.
 * Cada subclasse define nomeBanco/versao e as migrações em funcoesDeMigracao.
 *
 * Dois eventos (é um EventTarget) avisam de problemas de versão entre abas,
 * que de outra forma deixariam o app "vazio" sem explicação:
 *  - "bloqueado": esta aba precisa atualizar o banco, mas outra aba ainda
 *    segura uma conexão antiga aberta (a abertura fica pendurada até ela fechar).
 *  - "versao-alterada": outra aba atualizou o banco; esta conexão foi fechada
 *    (para não bloquear a outra) e precisa recarregar a página.
 */
export class DBBase extends EventTarget {

    static EVENTO_BLOQUEADO = "bloqueado";
    static EVENTO_VERSAO_ALTERADA = "versao-alterada";

    constructor(nomeBanco, versao, funcoesDeMigracao) {
        super();
        this.nomeBanco = nomeBanco;
        this.versao = versao;
        this.funcoesDeMigracao = funcoesDeMigracao;
        this.bancoPromise = this._abrirBanco();
    }

    _abrirBanco() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.nomeBanco, this.versao);

            request.onupgradeneeded = evento => {
                const banco = request.result;
                const versaoAnterior = evento.oldVersion;
                this.funcoesDeMigracao.forEach((migrar, indice) => {
                    const versaoDaMigracao = indice + 1;
                    if (versaoDaMigracao > versaoAnterior) {
                        migrar(banco, request.transaction);
                    }
                });
            };

            request.onblocked = () => {
                this.dispatchEvent(new CustomEvent(DBBase.EVENTO_BLOQUEADO));
            };

            request.onsuccess = () => {
                const banco = request.result;
                banco.onversionchange = () => {
                    banco.close();
                    this.dispatchEvent(new CustomEvent(DBBase.EVENTO_VERSAO_ALTERADA));
                };
                resolve(banco);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async _banco() {
        return this.bancoPromise;
    }

    async obterTodos(objectStore, indice, chave) {
        const banco = await this._banco();
        return new Promise((resolve, reject) => {
            const store = banco.transaction(objectStore, "readonly").objectStore(objectStore);
            const origem = indice ? store.index(indice) : store;
            const request = chave !== undefined ? origem.getAll(chave) : origem.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async obterPorChave(objectStore, chave) {
        const banco = await this._banco();
        return new Promise((resolve, reject) => {
            const store = banco.transaction(objectStore, "readonly").objectStore(objectStore);
            const request = store.get(chave);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async salvar(objectStore, registro) {
        const banco = await this._banco();
        return new Promise((resolve, reject) => {
            const store = banco.transaction(objectStore, "readwrite").objectStore(objectStore);
            const request = store.put(structuredClone(registro));
            request.onsuccess = () => resolve(registro);
            request.onerror = () => reject(request.error);
        });
    }

    async remover(objectStore, chave) {
        const banco = await this._banco();
        return new Promise((resolve, reject) => {
            const store = banco.transaction(objectStore, "readwrite").objectStore(objectStore);
            const request = store.delete(chave);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async removerVarios(objectStore, chaves) {
        const banco = await this._banco();
        return new Promise((resolve, reject) => {
            const transacao = banco.transaction(objectStore, "readwrite");
            const store = transacao.objectStore(objectStore);
            chaves.forEach(chave => store.delete(chave));
            transacao.oncomplete = () => resolve(true);
            transacao.onerror = () => reject(transacao.error);
        });
    }
}
