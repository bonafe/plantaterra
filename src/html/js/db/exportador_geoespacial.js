import { plantaTerraDB } from "./plantaterra_db.js";
import { baixarArquivo, slug } from "./exportador_projeto.js";
import { consolidarPontosDoProjeto } from "../dominio/nivelamento.js";
import { gerarCurvasDeNivel } from "../geo/curvas_de_nivel.js";
import { dividirEmMetros } from "../geo/segmentador_linha.js";
import { agruparPlantasPorMetro } from "../dominio/saf.js";

const CORES_ISOLINHA = ["#2b6cb0", "#2f855a", "#b7791f", "#c05621", "#9b2c2c", "#553c9a"];

/**
 * Exportações interoperáveis com GIS (QGIS, Google Earth etc). Diferente de
 * exportador_projeto.js, que gera um backup fiel para reimportar no próprio
 * app, aqui o formato é padrão (GeoJSON/KML/KMZ) e as curvas de nível e os
 * marcadores de planta por metro são recalculados na hora a partir dos dados
 * salvos (ver docs/especificacao.md secao 14.4).
 */
async function coletarDadosProjeto(projetoId) {
    const [projeto, trilhaAtiva, estacoesComLeituras, safsComLinhasBrutas, elementosContexto] = await Promise.all([
        plantaTerraDB.obterProjeto(projetoId),
        plantaTerraDB.trilhaAtiva(projetoId),
        plantaTerraDB.listarTodasLeiturasDoProjeto(projetoId),
        plantaTerraDB.listarTodasLinhasDoProjeto(projetoId),
        plantaTerraDB.listarElementosContexto(projetoId)
    ]);

    if (!projeto) {
        throw new Error("Projeto não encontrado.");
    }

    const pontos = consolidarPontosDoProjeto(estacoesComLeituras);
    const poligono = trilhaAtiva?.poligono?.length >= 3 ? trilhaAtiva.poligono : null;
    const { isolinhas } = pontos.length >= 3 ? gerarCurvasDeNivel(pontos, poligono) : { isolinhas: [] };

    const safsComLinhas = await Promise.all(
        safsComLinhasBrutas.map(async ({ saf, linhas }) => ({
            saf,
            linhas: await Promise.all(linhas.map(async linha => ({ linha, ...(await pontosPlantadosDaLinha(linha)) })))
        }))
    );

    return { projeto, poligono, estacoesComLeituras, isolinhas, safsComLinhas, elementosContexto };
}

async function pontosPlantadosDaLinha(linha) {
    const plantas = await plantaTerraDB.listarPlantasDaLinha(linha.id);
    if (plantas.length === 0) {
        return { plantas: [], pontosPlantados: [] };
    }

    const { segmentos } = dividirEmMetros(linha.geometria);
    const plantasPorMetro = agruparPlantasPorMetro(plantas);

    const pontosPlantados = [...plantasPorMetro.entries()]
        .map(([indiceMetro, plantasDoMetro]) => {
            const segmento = segmentos[indiceMetro];
            return segmento ? { indiceMetro, coordenada: segmento.meio, plantas: plantasDoMetro } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.indiceMetro - b.indiceMetro);

    return { plantas, pontosPlantados };
}

export async function exportarGeoJSON(projetoId) {
    const dados = await coletarDadosProjeto(projetoId);
    const geojson = construirGeoJSON(dados);
    baixarArquivo(
        JSON.stringify(geojson, null, 2),
        `plantaterra-${slug(dados.projeto.nome)}.geojson`,
        "application/geo+json"
    );
}

export async function exportarKML(projetoId) {
    const dados = await coletarDadosProjeto(projetoId);
    const kml = construirKML(dados);
    baixarArquivo(kml, `plantaterra-${slug(dados.projeto.nome)}.kml`, "application/vnd.google-earth.kml+xml");
}

/**
 * Exporta o polígono de uma única rodada de captura do perímetro (ver
 * histórico de rodadas), sem o resto dos dados do projeto — útil para
 * conferir/guardar uma rodada específica fora do app (ex: no Google Earth).
 */
export function exportarKMLTrilha(trilha, nomeProjeto) {
    if (!trilha.poligono || trilha.poligono.length < 3) {
        throw new Error("Esta rodada não tem um polígono válido para exportar.");
    }

    const nomePlacemark = `Perímetro — ${new Date(trilha.criado_em).toLocaleDateString("pt-BR")}`;
    const kml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
        `<name>${escaparXml(nomeProjeto)} — Perímetro</name>`,
        construirPlacemarkPerimetro(trilha.poligono, nomePlacemark),
        "</Document></kml>"
    ].join("\n");

    const data = new Date(trilha.criado_em).toISOString().slice(0, 10);
    baixarArquivo(kml, `plantaterra-${slug(nomeProjeto)}-perimetro-${data}.kml`, "application/vnd.google-earth.kml+xml");
}

export async function exportarKMZ(projetoId) {
    const dados = await coletarDadosProjeto(projetoId);
    const kml = construirKML(dados);
    const zip = fflate.zipSync({ "doc.kml": fflate.strToU8(kml) });
    baixarArquivo(zip, `plantaterra-${slug(dados.projeto.nome)}.kmz`, "application/vnd.google-earth.kmz");
}

function construirGeoJSON({ projeto, poligono, estacoesComLeituras, isolinhas, safsComLinhas, elementosContexto }) {
    const features = [];

    if (poligono) {
        const anel = poligono.map(p => [p.lon, p.lat]);
        anel.push(anel[0]);
        features.push({
            type: "Feature",
            properties: { tipo: "perimetro", projeto: projeto.nome },
            geometry: { type: "Polygon", coordinates: [anel] }
        });
    }

    for (const { estacao, leituras } of estacoesComLeituras) {
        features.push({
            type: "Feature",
            properties: { tipo: "estacao", nome: estacao.nome, altura_instrumento: estacao.altura_instrumento },
            geometry: { type: "Point", coordinates: [estacao.coordenada.lon, estacao.coordenada.lat] }
        });

        for (const leitura of leituras) {
            if (leitura.altitude_relativa === null) continue;
            features.push({
                type: "Feature",
                properties: {
                    tipo: "leitura",
                    estacao: estacao.nome,
                    altura_mira: leitura.altura_mira,
                    altitude_relativa_m: leitura.altitude_relativa,
                    ponto_amarracao: leitura.eh_ponto_amarracao
                },
                geometry: {
                    type: "Point",
                    coordinates: [leitura.coordenada.lon, leitura.coordenada.lat, leitura.altitude_relativa]
                }
            });
        }
    }

    for (const { nivel, pontos } of isolinhas) {
        features.push({
            type: "Feature",
            properties: { tipo: "curva_de_nivel", altitude_relativa_m: nivel },
            geometry: {
                type: "MultiLineString",
                coordinates: pontos.map(([p1, p2]) => [[p1.lon, p1.lat], [p2.lon, p2.lat]])
            }
        });
    }

    for (const { saf, linhas } of safsComLinhas) {
        for (const { linha, pontosPlantados } of linhas) {
            features.push({
                type: "Feature",
                properties: {
                    tipo: "linha_plantio",
                    saf: saf.nome,
                    numero_linha: linha.numero_linha,
                    descricao: linha.descricao,
                    comprimento_m: linha.comprimento_calculado_m
                },
                geometry: { type: "LineString", coordinates: linha.geometria.map(p => [p.lon, p.lat]) }
            });

            for (const { indiceMetro, coordenada, plantas } of pontosPlantados) {
                features.push({
                    type: "Feature",
                    properties: {
                        tipo: "planta",
                        saf: saf.nome,
                        linha: linha.numero_linha ?? linha.nome_original,
                        metro: indiceMetro,
                        plantas: plantas.map(p => ({
                            especie: p.especie,
                            quantidade: p.quantidade,
                            observacao: p.observacao,
                            data_plantio: p.data_plantio
                        }))
                    },
                    geometry: { type: "Point", coordinates: [coordenada.lon, coordenada.lat] }
                });
            }
        }
    }

    for (const elemento of elementosContexto) {
        const geometria = geometriaContextoParaGeoJSON(elemento);
        if (!geometria) continue;

        features.push({
            type: "Feature",
            properties: { tipo: "contexto", nome: elemento.nome, caminho: elemento.caminho },
            geometry: geometria
        });
    }

    return { type: "FeatureCollection", features };
}

function geometriaContextoParaGeoJSON(elemento) {
    const coordenadas = elemento.geometria.map(p => [p.lon, p.lat]);

    if (elemento.tipo === "Point") return { type: "Point", coordinates: coordenadas[0] };
    if (elemento.tipo === "LineString") return { type: "LineString", coordinates: coordenadas };
    if (elemento.tipo === "Polygon") return { type: "Polygon", coordinates: [[...coordenadas, coordenadas[0]]] };
    return null;
}

function construirKML({ projeto, poligono, estacoesComLeituras, isolinhas, safsComLinhas, elementosContexto }) {
    const partes = [];

    partes.push('<?xml version="1.0" encoding="UTF-8"?>');
    partes.push('<kml xmlns="http://www.opengis.net/kml/2.2"><Document>');
    partes.push(`<name>${escaparXml(projeto.nome)}</name>`);

    if (poligono) {
        partes.push(construirPlacemarkPerimetro(poligono));
    }

    for (const { estacao, leituras } of estacoesComLeituras) {
        partes.push(`
            <Placemark>
                <name>${escaparXml(estacao.nome)} (instrumento)</name>
                <description>Altura do instrumento: ${estacao.altura_instrumento} m</description>
                <Point><coordinates>${estacao.coordenada.lon},${estacao.coordenada.lat},0</coordinates></Point>
            </Placemark>
        `);

        for (const leitura of leituras) {
            if (leitura.altitude_relativa === null) continue;
            partes.push(`
                <Placemark>
                    <name>${escaparXml(estacao.nome)}: ${leitura.altitude_relativa.toFixed(2)} m</name>
                    <description>Mira: ${leitura.altura_mira} m${leitura.eh_ponto_amarracao ? " (ponto de amarração)" : ""}</description>
                    <Point><coordinates>${leitura.coordenada.lon},${leitura.coordenada.lat},${leitura.altitude_relativa}</coordinates></Point>
                </Placemark>
            `);
        }
    }

    isolinhas.forEach(({ nivel, pontos }, indice) => {
        const cor = CORES_ISOLINHA[indice % CORES_ISOLINHA.length];
        const linhas = pontos
            .map(([p1, p2]) => `
                <LineString><coordinates>${p1.lon},${p1.lat},0 ${p2.lon},${p2.lat},0</coordinates></LineString>
            `)
            .join("");

        partes.push(`
            <Placemark>
                <name>Curva ${nivel.toFixed(2)} m</name>
                <Style><LineStyle><color>${corParaKml(cor)}</color><width>2</width></LineStyle></Style>
                <MultiGeometry>${linhas}</MultiGeometry>
            </Placemark>
        `);
    });

    for (const { saf, linhas } of safsComLinhas) {
        partes.push(`<Folder><name>${escaparXml(saf.nome)}</name>`);

        for (const { linha, pontosPlantados } of linhas) {
            const coordenadasLinha = linha.geometria.map(p => `${p.lon},${p.lat},0`).join(" ");
            const totalPlantas = pontosPlantados.reduce((soma, p) => soma + p.plantas.length, 0);

            partes.push(`
                <Placemark>
                    <name>${escaparXml(linha.nome_original)}</name>
                    <description>Comprimento: ${linha.comprimento_calculado_m.toFixed(1)} m · ${totalPlantas} planta(s) cadastrada(s)</description>
                    <Style><LineStyle><color>ff2f855a</color><width>3</width></LineStyle></Style>
                    <LineString><coordinates>${coordenadasLinha}</coordinates></LineString>
                </Placemark>
            `);

            for (const { indiceMetro, coordenada, plantas } of pontosPlantados) {
                const listaPlantas = plantas
                    .map(p => escaparXml(`${p.especie}${p.quantidade ? ` (x${p.quantidade})` : ""}${p.observacao ? ` — ${p.observacao}` : ""}`))
                    .join("<br/>");

                partes.push(`
                    <Placemark>
                        <name>Metro ${indiceMetro}: ${escaparXml(plantas.map(p => p.especie).join(", "))}</name>
                        <description>${listaPlantas}</description>
                        <Point><coordinates>${coordenada.lon},${coordenada.lat},0</coordinates></Point>
                    </Placemark>
                `);
            }
        }

        partes.push("</Folder>");
    }

    if (elementosContexto.length > 0) {
        partes.push("<Folder><name>Contexto</name>");
        for (const elemento of elementosContexto) {
            const placemarkKml = elementoContextoParaKml(elemento);
            if (placemarkKml) partes.push(placemarkKml);
        }
        partes.push("</Folder>");
    }

    partes.push("</Document></kml>");
    return partes.join("\n");
}

function construirPlacemarkPerimetro(poligono, nome = "Perímetro") {
    const anel = poligono.map(p => `${p.lon},${p.lat},0`).concat(`${poligono[0].lon},${poligono[0].lat},0`);
    return `
        <Placemark>
            <name>${escaparXml(nome)}</name>
            <Style><LineStyle><color>ff805ad5</color><width>3</width></LineStyle>
            <PolyStyle><color>2a805ad5</color></PolyStyle></Style>
            <Polygon><outerBoundaryIs><LinearRing><coordinates>
                ${anel.join(" ")}
            </coordinates></LinearRing></outerBoundaryIs></Polygon>
        </Placemark>
    `;
}

function elementoContextoParaKml(elemento) {
    const nome = `<name>${escaparXml(elemento.nome)}</name>`;
    const estilo = '<Style><LineStyle><color>ff969696</color><width>2</width></LineStyle><PolyStyle><color>1a969696</color></PolyStyle></Style>';

    if (elemento.tipo === "Point") {
        const p = elemento.geometria[0];
        return `<Placemark>${nome}<Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`;
    }
    if (elemento.tipo === "LineString") {
        const coordenadas = elemento.geometria.map(p => `${p.lon},${p.lat},0`).join(" ");
        return `<Placemark>${nome}${estilo}<LineString><coordinates>${coordenadas}</coordinates></LineString></Placemark>`;
    }
    if (elemento.tipo === "Polygon") {
        const anel = elemento.geometria.map(p => `${p.lon},${p.lat},0`);
        anel.push(anel[0]);
        return `<Placemark>${nome}${estilo}<Polygon><outerBoundaryIs><LinearRing><coordinates>${anel.join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
    }
    return null;
}

function corParaKml(corHex) {
    const r = corHex.slice(1, 3);
    const g = corHex.slice(3, 5);
    const b = corHex.slice(5, 7);
    return `ff${b}${g}${r}`;
}

function escaparXml(texto) {
    return String(texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
