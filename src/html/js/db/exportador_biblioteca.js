import { plantaTerraDB } from "./plantaterra_db.js";
import { baixarArquivo } from "./util_arquivo.js";
import { chaveEspecie, ehCatalogoBotanico, especieDeRegistroCatalogo, normalizarNome, sanearEspecie } from "../dominio/biblioteca_plantas.js";

const FORMATO = "plantaterra-biblioteca";
const FORMATO_VERSAO = 1;

/** Só os campos de domínio (sem id/datas) — o mesmo formato serve ao arquivo da biblioteca e ao backup completo. */
export function serializarEspecies(especies) {
    return especies.map(({ id, criado_em, atualizado_em, ...campos }) => campos);
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

    // Catálogo botânico agroflorestal (um registro rico por espécie): vira espécies da biblioteca.
    if (ehCatalogoBotanico(pacote)) {
        return mesclarEspecies(pacote.plantas.map(especieDeRegistroCatalogo), { porCientifico: true });
    }

    if (pacote?.formato !== FORMATO) {
        throw new Error("o arquivo não é uma biblioteca de plantas do PlantaTerra nem um catálogo botânico.");
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
export async function mesclarEspecies(lista, { porCientifico = false } = {}) {
    const existentes = await plantaTerraDB.listarEspecies();
    const nomesConhecidos = new Set(existentes.map(e => chaveEspecie(e.nome_popular, e.nome_cientifico)));
    // Importando o catálogo: a mesma espécie (mesmo nome científico) já na biblioteca, com outro nome popular, não duplica.
    const cientificosConhecidos = new Set(existentes.map(e => normalizarNome(e.nome_cientifico)).filter(Boolean));

    const resumo = { adicionadas: 0, jaExistentes: 0, invalidas: 0 };
    for (const bruta of lista) {
        const especie = sanearEspecie(bruta);
        if (!especie) {
            resumo.invalidas++;
            continue;
        }
        const chave = chaveEspecie(especie.nomePopular, especie.nomeCientifico);
        const cientifico = normalizarNome(especie.nomeCientifico);
        if (nomesConhecidos.has(chave) || (porCientifico && cientifico && cientificosConhecidos.has(cientifico))) {
            resumo.jaExistentes++;
            continue;
        }
        await plantaTerraDB.criarEspecie(especie);
        nomesConhecidos.add(chave);
        if (cientifico) cientificosConhecidos.add(cientifico);
        resumo.adicionadas++;
    }
    return resumo;
}
