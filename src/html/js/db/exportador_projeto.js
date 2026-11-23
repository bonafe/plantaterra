import { plantaTerraDB } from "./plantaterra_db.js";
import { baixarArquivo, slug } from "./util_arquivo.js";
import { importarBiblioteca } from "./exportador_biblioteca.js";
import { incorporarInstantaneos, instantaneosDasEspecies, mesclarFichas } from "./biblioteca.js";
import { chaveEspecie, ehCatalogoBotanico } from "../dominio/biblioteca_plantas.js";

// Reexportados porque outros módulos (exportador_geoespacial) importam daqui.
export { baixarArquivo, slug };

/**
 * Backup fiel (round-trip completo dentro do próprio PlantaTerra) — ver
 * docs/especificacao.md secao 8. Um mesmo arquivo carrega quantos projetos a
 * pessoa escolher, mais as FICHAS DAS ESPÉCIES QUE ELES USAM (`especies`, só a foto
 * de capa): o backup fica enxuto e o projeto abre em outro aparelho mesmo sem o catálogo.
 */
const FORMATO = "plantaterra-backup";
const FORMATO_VERSAO = 1;
const FORMATO_BIBLIOTECA = "plantaterra-biblioteca";

/** Tudo que pertence a um projeto, em estruturas aninhadas (os vínculos por id são refeitos na importação). */
async function coletarProjeto(projetoId) {
    const [projeto, trilhas, estacoesComLeituras, safsComLinhas, elementosContexto] = await Promise.all([
        plantaTerraDB.obterProjeto(projetoId),
        plantaTerraDB.listarTrilhas(projetoId),
        plantaTerraDB.listarTodasLeiturasDoProjeto(projetoId),
        plantaTerraDB.listarTodasLinhasDoProjeto(projetoId),
        plantaTerraDB.listarElementosContexto(projetoId)
    ]);

    if (!projeto) {
        throw new Error("Projeto não encontrado.");
    }

    const safs = await Promise.all(safsComLinhas.map(async ({ saf, linhas }) => ({
        saf,
        linhas: await Promise.all(linhas.map(async linha => ({
            linha,
            plantas: await plantaTerraDB.listarPlantasDaLinha(linha.id)
        })))
    })));

    return {
        projeto,
        trilhas,
        estacoes: estacoesComLeituras.map(({ estacao, leituras }) => ({ estacao, leituras })),
        safs,
        elementos_contexto: elementosContexto
    };
}

export async function montarBackup({ projetoIds, incluirBiblioteca = false, todasAsFotos = false }) {
    const projetos = [];
    for (const id of projetoIds) {
        projetos.push(await coletarProjeto(id));
    }

    // As espécies que as plantas desses projetos usam, em instantâneo leve (ficha sem fotos, só a capa).
    const idsDeEspecies = projetos.flatMap(p => p.safs.flatMap(s => s.linhas.flatMap(l => l.plantas.map(pl => pl.especie_id))));

    return {
        formato: FORMATO,
        formato_versao: FORMATO_VERSAO,
        exportado_em: Date.now(),
        projetos,
        // `biblioteca_completa`: o backup leva TODAS as fichas da biblioteca (não só as dos projetos) — a importação avisa quantas entraram.
        ...(incluirBiblioteca ? { biblioteca_completa: true } : {}),
        especies: await instantaneosDasEspecies(idsDeEspecies, { incluirTodasAsFichas: incluirBiblioteca, todasAsFotos })
    };
}

/** Tamanho aproximado (bytes) que a biblioteca inteira ocupa no backup, com só a capa ou com todas as fotos. */
export async function estimarBibliotecaNoBackup({ todasAsFotos }) {
    return JSON.stringify(await instantaneosDasEspecies([], { incluirTodasAsFichas: true, todasAsFotos })).length;
}

export async function exportarBackup({ projetoIds, incluirBiblioteca = false, todasAsFotos = false }) {
    const pacote = await montarBackup({ projetoIds, incluirBiblioteca, todasAsFotos });
    const data = new Date().toISOString().slice(0, 10);
    const soUmProjeto = pacote.projetos.length === 1 && !incluirBiblioteca;
    const nomeArquivo = pacote.projetos.length === 0
        ? `plantaterra-biblioteca-backup-${data}.json`
        : soUmProjeto
        ? `plantaterra-${slug(pacote.projetos[0].projeto.nome)}-${data}.json`
        : `plantaterra-backup-${data}.json`;
    baixarArquivo(JSON.stringify(pacote, null, 2), nomeArquivo, "application/json");
    return pacote;
}

export async function exportarProjeto(projetoId) {
    return exportarBackup({ projetoIds: [projetoId] });
}

/**
 * Lê um arquivo do PlantaTerra e o importa: backup completo, projeto avulso
 * de versões antigas do app (sem campo "formato") ou só fichas de biblioteca.
 * Nunca sobrescreve nada: projetos entram como novos (com novos UUIDs) e as
 * espécies do backup entram na biblioteca só se ainda não estão lá.
 *
 * @returns {Promise<{ projetos: object[], biblioteca: {adicionadas, jaExistentes, invalidas} | null }>}
 */
export async function importarArquivo(arquivoOuTexto) {
    const texto = typeof arquivoOuTexto === "string" ? arquivoOuTexto : await arquivoOuTexto.text();

    let pacote;
    try {
        pacote = JSON.parse(texto);
    } catch {
        throw new Error("o arquivo não é um JSON válido.");
    }

    if (pacote?.formato === FORMATO_BIBLIOTECA || ehCatalogoBotanico(pacote)) {
        return { projetos: [], biblioteca: await importarBiblioteca(texto) };
    }

    let entradas;
    let instantaneos = null;
    let especiesLegadas = null;

    if (pacote?.formato === FORMATO) {
        if (pacote.formato_versao !== FORMATO_VERSAO) {
            throw new Error(`formato de backup não suportado (versão ${pacote.formato_versao}).`);
        }
        if (!Array.isArray(pacote.projetos)) {
            throw new Error("o arquivo não tem uma lista de projetos.");
        }
        entradas = pacote.projetos;
        instantaneos = Array.isArray(pacote.especies) ? pacote.especies : null;
        // Backups antigos levavam a biblioteca inteira, no formato de espécie; as plantas se religam pelo nome.
        especiesLegadas = Array.isArray(pacote.biblioteca) ? pacote.biblioteca : null;
    } else if (pacote && !pacote.formato && pacote.formato_versao === 1 && pacote.projeto) {
        // Arquivo de projeto avulso das primeiras versões: só perímetros e estações.
        entradas = [{ projeto: pacote.projeto, trilhas: pacote.trilhas, estacoes: pacote.estacoes }];
    } else {
        throw new Error("o arquivo não é um backup do PlantaTerra.");
    }

    for (const entrada of entradas) {
        if (!entrada?.projeto?.id || typeof entrada.projeto.nome !== "string") {
            throw new Error("o arquivo tem um projeto inválido.");
        }
    }

    // Biblioteca primeiro: as espécies que os projetos usam precisam existir antes de as plantas apontarem para elas.
    const resumoInstantaneos = instantaneos ? await incorporarInstantaneos(instantaneos) : null;
    const resumoLegado = especiesLegadas ? await mesclarFichas(especiesLegadas) : null;
    const idPorChave = resumoLegado?.idPorChave ?? new Map();
    // O resumo da biblioteca só aparece quando o backup levava a biblioteca toda (ou é um backup antigo, que sempre levava).
    const resumoBiblioteca = resumoLegado ?? (pacote.biblioteca_completa ? resumoInstantaneos : null);

    const nomesEmUso = new Set((await plantaTerraDB.listarProjetos()).map(p => p.nome));

    const projetosImportados = [];
    for (const entrada of entradas) {
        projetosImportados.push(await importarEntradaDeProjeto(entrada, idPorChave, nomesEmUso));
    }

    return { projetos: projetosImportados, biblioteca: resumoBiblioteca };
}

async function importarEntradaDeProjeto(entrada, idPorChave, nomesEmUso) {
    const mapaIds = new Map();
    const novoId = idAntigo => {
        if (!mapaIds.has(idAntigo)) {
            mapaIds.set(idAntigo, plantaTerraDB.gerarId());
        }
        return mapaIds.get(idAntigo);
    };

    // Só marca "(importado)" quando já existe projeto com o mesmo nome — ao
    // restaurar um backup num aparelho vazio, os nomes voltam como eram.
    const nomeOriginal = entrada.projeto.nome;
    const nome = nomesEmUso.has(nomeOriginal) ? `${nomeOriginal} (importado)` : nomeOriginal;
    nomesEmUso.add(nome);

    const projetoNovo = { ...entrada.projeto, id: novoId(entrada.projeto.id), nome };
    await plantaTerraDB.salvar("projeto", projetoNovo);

    for (const trilha of entrada.trilhas ?? []) {
        await plantaTerraDB.salvarTrilha({ ...trilha, id: novoId(trilha.id), projeto_id: projetoNovo.id });
    }

    for (const { estacao, leituras } of entrada.estacoes ?? []) {
        const estacaoNova = {
            ...estacao,
            id: novoId(estacao.id),
            projeto_id: projetoNovo.id,
            amarrada_a_estacao_id: estacao.amarrada_a_estacao_id ? novoId(estacao.amarrada_a_estacao_id) : null
        };
        await plantaTerraDB.salvar("estacao_nivel", estacaoNova);

        for (const leitura of leituras ?? []) {
            await plantaTerraDB.salvar("leitura_nivel", { ...leitura, id: novoId(leitura.id), estacao_id: estacaoNova.id });
        }
    }

    for (const { saf, linhas } of entrada.safs ?? []) {
        const safNovo = { ...saf, id: novoId(saf.id), projeto_id: projetoNovo.id };
        await plantaTerraDB.salvar("saf", safNovo);

        for (const { linha, plantas } of linhas ?? []) {
            const linhaNova = { ...linha, id: novoId(linha.id), saf_id: safNovo.id, projeto_id: projetoNovo.id };
            await plantaTerraDB.salvar("linha_plantio", linhaNova);

            for (const planta of plantas ?? []) {
                // Backup novo: `especie_id` é o id do registro da biblioteca e as espécies vieram junto (já incorporadas).
                // Backup antigo (levava a biblioteca no formato de espécie): religa pela dupla popular + científico.
                const especieId = planta.especie_nome_cientifico !== undefined || !planta.especie_id
                    ? (idPorChave.get(chaveEspecie(planta.especie, planta.especie_nome_cientifico)) ?? null)
                    : planta.especie_id;
                const { especie_nome_cientifico, ...plantaSemAuxiliar } = planta;
                await plantaTerraDB.salvar("planta_linha", {
                    ...plantaSemAuxiliar,
                    id: novoId(planta.id),
                    linha_id: linhaNova.id,
                    especie_id: especieId
                });
            }
        }
    }

    for (const elemento of entrada.elementos_contexto ?? []) {
        await plantaTerraDB.salvar("elemento_contexto", { ...elemento, id: novoId(elemento.id), projeto_id: projetoNovo.id });
    }

    return projetoNovo;
}
