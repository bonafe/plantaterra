import { plantaTerraDB } from "./plantaterra_db.js";

const FORMATO_VERSAO = 1;

export async function exportarProjeto(projetoId) {
    const [projeto, trilhas, estacoesComLeituras] = await Promise.all([
        plantaTerraDB.obterProjeto(projetoId),
        plantaTerraDB.listarTrilhas(projetoId),
        plantaTerraDB.listarTodasLeiturasDoProjeto(projetoId)
    ]);

    if (!projeto) {
        throw new Error("Projeto não encontrado.");
    }

    const pacote = {
        formato_versao: FORMATO_VERSAO,
        exportado_em: Date.now(),
        projeto,
        trilhas,
        estacoes: estacoesComLeituras.map(({ estacao, leituras }) => ({ estacao, leituras }))
    };

    const nomeArquivo = `plantaterra-${slug(projeto.nome)}-${new Date().toISOString().slice(0, 10)}.json`;
    baixarArquivoJson(pacote, nomeArquivo);
    return pacote;
}

export async function importarProjeto(arquivoOuTexto) {
    const texto = typeof arquivoOuTexto === "string" ? arquivoOuTexto : await arquivoOuTexto.text();
    const pacote = JSON.parse(texto);

    if (pacote.formato_versao !== FORMATO_VERSAO) {
        throw new Error(`Formato de arquivo não suportado (versão ${pacote.formato_versao}).`);
    }

    const mapaIdsAntigosParaNovos = new Map();
    const novoId = idAntigo => {
        if (!mapaIdsAntigosParaNovos.has(idAntigo)) {
            mapaIdsAntigosParaNovos.set(idAntigo, plantaTerraDB.gerarId());
        }
        return mapaIdsAntigosParaNovos.get(idAntigo);
    };

    const projetoNovo = {
        ...pacote.projeto,
        id: novoId(pacote.projeto.id),
        nome: `${pacote.projeto.nome} (importado)`
    };
    await plantaTerraDB.salvar("projeto", projetoNovo);

    for (const trilha of pacote.trilhas ?? []) {
        await plantaTerraDB.salvarTrilha({
            ...trilha,
            id: novoId(trilha.id),
            projeto_id: projetoNovo.id
        });
    }

    for (const { estacao, leituras } of pacote.estacoes ?? []) {
        const estacaoNova = {
            ...estacao,
            id: novoId(estacao.id),
            projeto_id: projetoNovo.id,
            amarrada_a_estacao_id: estacao.amarrada_a_estacao_id ? novoId(estacao.amarrada_a_estacao_id) : null
        };
        await plantaTerraDB.salvar("estacao_nivel", estacaoNova);

        for (const leitura of leituras) {
            await plantaTerraDB.salvar("leitura_nivel", {
                ...leitura,
                id: novoId(leitura.id),
                estacao_id: estacaoNova.id
            });
        }
    }

    return projetoNovo;
}

function baixarArquivoJson(objeto, nomeArquivo) {
    const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    link.click();
    URL.revokeObjectURL(url);
}

function slug(texto) {
    return texto
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}
