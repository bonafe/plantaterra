import { plantaTerraDB } from "../db/plantaterra_db.js";
import { lerArvoreKml } from "./leitor_kml.js";
import { ehPastaSaf, ehPlacemarkLinha, parsearNomeLinha } from "../dominio/saf.js";
import { comprimentoPoligonal, centralizarFaixaPoligonal } from "../geo/geodesia.js";

/**
 * Lê um arquivo KML/KMZ e monta uma pré-visualização de SAFs/linhas
 * reconhecidas, sem persistir nada ainda (ver docs/especificacao.md secao 14.3).
 */
export async function analisarArquivoParaImportacao(arquivoOuArrayBuffer) {
    const arvore = await lerArvoreKml(arquivoOuArrayBuffer);
    const safsEncontradas = [];
    const avisos = [];

    function caminharPastas(no) {
        if (ehPastaSaf(no.nome)) {
            const linhas = [];
            coletarLinhas(no, linhas);
            if (linhas.length === 0) {
                avisos.push(`A pasta "${no.nome}" parece ser um SAF, mas nenhuma linha foi encontrada dentro dela.`);
            }
            safsEncontradas.push({ nomeOriginal: no.nome, linhas });
        } else {
            no.filhos.filter(f => f.tipo === "pasta").forEach(caminharPastas);
        }
    }

    function coletarLinhas(no, acumulador) {
        for (const filho of no.filhos) {
            if (filho.tipo === "pasta") {
                coletarLinhas(filho, acumulador);
                continue;
            }
            if (!ehPlacemarkLinha(filho.nome)) continue;

            const geometria = extrairGeometriaDaLinha(filho.geometria);
            if (!geometria || geometria.length < 2) {
                avisos.push(
                    `"${filho.nome}" começa com "Linha" mas não tem uma geometria utilizável ` +
                    "(linha ou polígono de faixa estreita) — ignorada."
                );
                continue;
            }

            const { numero, descricao, metrosDeclarados } = parsearNomeLinha(filho.nome);

            acumulador.push({
                nomeOriginal: filho.nome,
                numero,
                descricao,
                metrosDeclarados,
                comprimentoCalculadoM: comprimentoPoligonal(geometria),
                geometria
            });
        }
    }

    caminharPastas(arvore);

    if (safsEncontradas.length === 0) {
        avisos.push("Nenhuma pasta cujo nome começa com \"SAF\" foi encontrada no arquivo.");
    }

    return { safsEncontradas, avisos };
}

/**
 * Aceita tanto uma geometria de linha (LineString) quanto um polígono estreito
 * (Polygon com largura, ex: uma linha de plantio desenhada com sua largura
 * real) — nesse caso deriva a linha central. Ver docs/especificacao.md secao 14.3.
 */
function extrairGeometriaDaLinha(geometria) {
    if (!geometria) return null;

    const pontos = geometria.pontos.map(p => ({ lat: p.lat, lon: p.lon }));

    if (geometria.tipo === "LineString") return pontos;
    if (geometria.tipo === "Polygon") return centralizarFaixaPoligonal(pontos);
    return null;
}

/**
 * Persiste as SAFs/linhas selecionadas na pré-visualização. Faz upsert por
 * nome (dentro do projeto para SAF, dentro da SAF para linha), preservando
 * as PlantaLinha já cadastradas em reimportações.
 */
export async function importarParaProjeto(projetoId, safsSelecionadas) {
    const resultado = { safsCriadas: 0, safsAtualizadas: 0, linhasCriadas: 0, linhasAtualizadas: 0 };

    for (const safImportada of safsSelecionadas) {
        if (safImportada.linhas.length === 0) continue;

        let saf = await plantaTerraDB.obterSafPorNome(projetoId, safImportada.nomeOriginal);
        if (saf) {
            resultado.safsAtualizadas++;
        } else {
            saf = await plantaTerraDB.criarSaf({ projetoId, nome: safImportada.nomeOriginal, origem: "kmz_importado" });
            resultado.safsCriadas++;
        }

        for (const linhaImportada of safImportada.linhas) {
            const linhaExistente = await plantaTerraDB.obterLinhaPorNome(saf.id, linhaImportada.nomeOriginal);

            if (linhaExistente) {
                await plantaTerraDB.atualizarLinha({
                    ...linhaExistente,
                    numero_linha: linhaImportada.numero,
                    descricao: linhaImportada.descricao,
                    metros_lineares_declarado: linhaImportada.metrosDeclarados,
                    comprimento_calculado_m: linhaImportada.comprimentoCalculadoM,
                    geometria: linhaImportada.geometria
                });
                resultado.linhasAtualizadas++;
            } else {
                await plantaTerraDB.criarLinha({
                    safId: saf.id,
                    projetoId,
                    nomeOriginal: linhaImportada.nomeOriginal,
                    numeroLinha: linhaImportada.numero,
                    descricao: linhaImportada.descricao,
                    metrosLinearesDeclarado: linhaImportada.metrosDeclarados,
                    comprimentoCalculadoM: linhaImportada.comprimentoCalculadoM,
                    geometria: linhaImportada.geometria,
                    origem: "kmz_importado"
                });
                resultado.linhasCriadas++;
            }
        }
    }

    return resultado;
}
