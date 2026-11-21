import { plantaTerraDB } from "./plantaterra_db.js";
import { baixarArquivo } from "./exportador_projeto.js";
import { normalizarNome, sanearEspecie } from "../dominio/biblioteca_plantas.js";

const FORMATO = "plantaterra-biblioteca";
const FORMATO_VERSAO = 1;

export async function exportarBiblioteca() {
    const especies = await plantaTerraDB.listarEspecies();
    const pacote = {
        formato: FORMATO,
        formato_versao: FORMATO_VERSAO,
        exportado_em: Date.now(),
        especies: especies.map(({ nome_popular, nome_cientifico, ciclo, espacamento_recomendado_m, notas }) => ({
            nome_popular, nome_cientifico, ciclo, espacamento_recomendado_m, notas
        }))
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

    const existentes = await plantaTerraDB.listarEspecies();
    const nomesConhecidos = new Set(existentes.map(e => normalizarNome(e.nome_popular)));

    const resumo = { adicionadas: 0, jaExistentes: 0, invalidas: 0 };
    for (const bruta of pacote.especies) {
        const especie = sanearEspecie(bruta);
        if (!especie) {
            resumo.invalidas++;
            continue;
        }
        const chave = normalizarNome(especie.nomePopular);
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
