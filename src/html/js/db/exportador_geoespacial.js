import { plantaTerraDB } from "./plantaterra_db.js";
import { baixarArquivo, slug } from "./exportador_projeto.js";
import { consolidarPontosDoProjeto } from "../dominio/nivelamento.js";
import { gerarCurvasDeNivel } from "../geo/curvas_de_nivel.js";

const CORES_ISOLINHA = ["#2b6cb0", "#2f855a", "#b7791f", "#c05621", "#9b2c2c", "#553c9a"];

/**
 * Exportações interoperáveis com GIS (QGIS, Google Earth etc). Diferente de
 * exportador_projeto.js, que gera um backup fiel para reimportar no próprio
 * app, aqui o formato é padrão (GeoJSON/KML) e as curvas de nível são
 * recalculadas na hora a partir das leituras salvas.
 */
async function coletarDadosProjeto(projetoId) {
    const [projeto, trilhaAtiva, estacoesComLeituras] = await Promise.all([
        plantaTerraDB.obterProjeto(projetoId),
        plantaTerraDB.trilhaAtiva(projetoId),
        plantaTerraDB.listarTodasLeiturasDoProjeto(projetoId)
    ]);

    if (!projeto) {
        throw new Error("Projeto não encontrado.");
    }

    const pontos = consolidarPontosDoProjeto(estacoesComLeituras);
    const poligono = trilhaAtiva?.poligono?.length >= 3 ? trilhaAtiva.poligono : null;
    const { isolinhas } = pontos.length >= 3 ? gerarCurvasDeNivel(pontos, poligono) : { isolinhas: [] };

    return { projeto, poligono, estacoesComLeituras, isolinhas };
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

function construirGeoJSON({ projeto, poligono, estacoesComLeituras, isolinhas }) {
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

    return { type: "FeatureCollection", features };
}

function construirKML({ projeto, poligono, estacoesComLeituras, isolinhas }) {
    const partes = [];

    partes.push('<?xml version="1.0" encoding="UTF-8"?>');
    partes.push('<kml xmlns="http://www.opengis.net/kml/2.2"><Document>');
    partes.push(`<name>${escaparXml(projeto.nome)}</name>`);

    if (poligono) {
        const anel = poligono.map(p => `${p.lon},${p.lat},0`).concat(`${poligono[0].lon},${poligono[0].lat},0`);
        partes.push(`
            <Placemark>
                <name>Perímetro</name>
                <Style><LineStyle><color>ff805ad5</color><width>3</width></LineStyle>
                <PolyStyle><color>2a805ad5</color></PolyStyle></Style>
                <Polygon><outerBoundaryIs><LinearRing><coordinates>
                    ${anel.join(" ")}
                </coordinates></LinearRing></outerBoundaryIs></Polygon>
            </Placemark>
        `);
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

    partes.push("</Document></kml>");
    return partes.join("\n");
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
