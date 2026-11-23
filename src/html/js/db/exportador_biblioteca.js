import { baixarArquivo } from "./util_arquivo.js";
import { ehCatalogoBotanico, especieDeRegistroCatalogo } from "../dominio/biblioteca_plantas.js";
import { listarFichas, mesclarFichas } from "./biblioteca.js";

const FORMATO = "plantaterra-biblioteca";
const FORMATO_VERSAO = 2;

/**
 * Exporta as FICHAS da biblioteca (espécies com dados ricos, com todas as fotos) — o que se manda a outra pessoa. O
 * catálogo nacional tem exportação própria (db/catalogo_nacional.js). `catalogo_id` leva o id do táxon: na importação a
 * ficha volta ao mesmo táxon, mesmo em outro aparelho.
 * @returns {Promise<number>} quantidade de fichas exportadas
 */
export async function exportarFichas() {
    const registros = await listarFichas();
    if (registros.length === 0) return 0;
    const pacote = {
        formato: FORMATO,
        formato_versao: FORMATO_VERSAO,
        exportado_em: Date.now(),
        especies: registros.map(r => ({ ...r.ficha, catalogo_id: r.propria ? (r.ficha.catalogo_id ?? null) : r.id }))
    };
    const data = new Date().toISOString().slice(0, 10);
    baixarArquivo(JSON.stringify(pacote), `plantaterra-fichas-${data}.json`, "application/json");
    return registros.length;
}

/**
 * Importa um arquivo de fichas: o formato desta biblioteca (versões 1 e 2) ou um catálogo botânico (um registro rico por
 * espécie). Cada ficha vai para o registro do táxon correspondente; a que veio do mesmo arquivo é atualizada, a de outro arquivo
 * ou editada pela pessoa só recebe o que falta (db/biblioteca.js#mesclarFichas).
 * @returns {Promise<{ adicionadas, atualizadas, complementadas, preservadas, invalidas, idPorChave }>}
 */
export async function importarBiblioteca(arquivoOuTexto, aoProgredir = () => {}) {
    const texto = typeof arquivoOuTexto === "string" ? arquivoOuTexto : await arquivoOuTexto.text();

    let pacote;
    try {
        pacote = JSON.parse(texto);
    } catch {
        throw new Error("o arquivo não é um JSON válido.");
    }

    if (ehCatalogoBotanico(pacote)) return mesclarFichas(pacote.plantas.map(especieDeRegistroCatalogo), aoProgredir, pacote.titulo ?? "catalogo-botanico");

    if (pacote?.formato !== FORMATO) {
        throw new Error("o arquivo não é uma biblioteca de plantas do PlantaTerra nem um catálogo botânico.");
    }
    if (![1, 2].includes(pacote.formato_versao)) {
        throw new Error(`formato de biblioteca não suportado (versão ${pacote.formato_versao}).`);
    }
    if (!Array.isArray(pacote.especies)) {
        throw new Error("o arquivo não tem uma lista de espécies.");
    }
    return mesclarFichas(pacote.especies, aoProgredir, "fichas-plantaterra");
}
