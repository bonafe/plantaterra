import { plantaTerraDB } from "./plantaterra_db.js";
import { baixarArquivo } from "./util_arquivo.js";
import { chaveEspecie, sanearEspecie } from "../dominio/biblioteca_plantas.js";

const FORMATO = "plantaterra-biblioteca";
const FORMATO_VERSAO = 1;

/** Só os campos de domínio (sem id/datas) — o mesmo formato serve ao arquivo da biblioteca e ao backup completo. */
export function serializarEspecies(especies) {
    return especies.map(({ nome_popular, nome_cientifico, ciclo, espacamento_recomendado_m, notas }) => ({
        nome_popular, nome_cientifico, ciclo, espacamento_recomendado_m, notas
    }));
}

export async function exportarBiblioteca() {
    const especies = await plantaTerraDB.listarEspecies();
    const pacote = {
        formato: FORMATO,
        formato_versao: FORMATO_VERSAO,
        exportado_em: Date.now(),
        especies: serializarEspecies(especies)
    };
    const data = new Date().toISOString().slice(0, 10);
    baixarArquivo(JSON.stringify(pacote, null, 2), `plantaterra-biblioteca-${data}.json`, "application/json");
    return pacote;
}

/**
 * Mescla um catálogo importado ao existente. Espécie com nome popular já
 * existente (ignorando caixa/acento) é pulada, não sobrescrita — importar
 * nunca destrói o que a pessoa já cadastrou.
 * @returns {{ adicionadas: number, jaExistentes: number, invalidas: number }}
 */
export async function importarBiblioteca(arquivoOuTexto) {
    const texto = typeof arquivoOuTexto === "string" ? arquivoOuTexto : await arquivoOuTexto.text();

    let pacote;
    try {
        pacote = JSON.parse(texto);
    } catch {
        throw new Error("o arquivo não é um JSON válido.");
    }

    if (pacote?.formato !== FORMATO) {
        throw new Error("o arquivo não é uma biblioteca de plantas do PlantaTerra.");
    }
    if (pacote.formato_versao !== FORMATO_VERSAO) {
        throw new Error(`formato de biblioteca não suportado (versão ${pacote.formato_versao}).`);
    }
    if (!Array.isArray(pacote.especies)) {
        throw new Error("o arquivo não tem uma lista de espécies.");
    }

    return mesclarEspecies(pacote.especies);
}

/**
 * Mescla uma lista de espécies (já no formato serializado) ao catálogo local.
 * @returns {{ adicionadas: number, jaExistentes: number, invalidas: number }}
 */
export async function mesclarEspecies(lista) {
    const existentes = await plantaTerraDB.listarEspecies();
    const nomesConhecidos = new Set(existentes.map(e => chaveEspecie(e.nome_popular, e.nome_cientifico)));

    const resumo = { adicionadas: 0, jaExistentes: 0, invalidas: 0 };
    for (const bruta of lista) {
        const especie = sanearEspecie(bruta);
        if (!especie) {
            resumo.invalidas++;
            continue;
        }
        const chave = chaveEspecie(especie.nomePopular, especie.nomeCientifico);
        if (nomesConhecidos.has(chave)) {
            resumo.jaExistentes++;
            continue;
        }
        await plantaTerraDB.criarEspecie(especie);
        nomesConhecidos.add(chave);
        resumo.adicionadas++;
    }
    return resumo;
}
