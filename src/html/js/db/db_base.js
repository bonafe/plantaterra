/**
 * Wrapper Promise-based mínimo sobre IndexedDB.
 * Cada subclasse define nomeBanco/versao e as migrações em funcoesDeMigracao.
 */
export class DBBase {

    constructor(nomeBanco, versao, funcoesDeMigracao) {
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
                        migrar(banco);
                    }
                });
            };

            request.onsuccess = () => resolve(request.result);
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
