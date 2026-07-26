/**
 * Leitura genérica de KML/KMZ (sem conhecimento do domínio SAF/Linha) para
 * uma árvore de pastas/placemarks. Usa `fflate` (global, carregado via
 * <script> em index.html) para descompactar KMZ.
 */

export async function lerArvoreKml(arquivoOuArrayBuffer) {
    const bytes = await paraUint8Array(arquivoOuArrayBuffer);
    const textoKml = ehZip(bytes) ? extrairKmlDoZip(bytes) : new TextDecoder("utf-8").decode(bytes);

    const documentoXml = new DOMParser().parseFromString(textoKml, "application/xml");
    const erroParse = documentoXml.querySelector("parsererror");
    if (erroParse) {
        throw new Error("Arquivo KML inválido ou corrompido.");
    }

    const elementoKml = primeiroFilhoComNome(documentoXml, "kml") ?? documentoXml.documentElement;
    const raiz = primeiroFilhoComNome(elementoKml, "Document") ?? elementoKml;

    return {
        tipo: "pasta",
        nome: textoDoFilho(raiz, "name") ?? "",
        filhos: filhosComoArvore(raiz)
    };
}

async function paraUint8Array(entrada) {
    if (entrada instanceof Uint8Array) return entrada;
    const arrayBuffer = entrada instanceof ArrayBuffer ? entrada : await entrada.arrayBuffer();
    return new Uint8Array(arrayBuffer);
}

function ehZip(bytes) {
    return bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function extrairKmlDoZip(bytes) {
    const arquivos = fflate.unzipSync(bytes);
    const nomes = Object.keys(arquivos);
    const nomeKml =
        nomes.find(n => n.toLowerCase() === "doc.kml") ?? nomes.find(n => n.toLowerCase().endsWith(".kml"));

    if (!nomeKml) {
        throw new Error("O arquivo KMZ não contém nenhum documento .kml.");
    }

    return fflate.strFromU8(arquivos[nomeKml]);
}

function filhosComoArvore(elemento) {
    const nos = [];
    for (const filho of elemento.children) {
        const nomeTag = filho.localName ?? filho.tagName;

        if (nomeTag === "Folder") {
            nos.push({ tipo: "pasta", nome: textoDoFilho(filho, "name") ?? "", filhos: filhosComoArvore(filho) });
        } else if (nomeTag === "Placemark") {
            nos.push({
                tipo: "placemark",
                nome: textoDoFilho(filho, "name") ?? "",
                geometria: extrairGeometria(filho)
            });
        }
    }
    return nos;
}

function primeiroFilhoComNome(elemento, nomeTag) {
    for (const filho of elemento.children ?? []) {
        if ((filho.localName ?? filho.tagName) === nomeTag) return filho;
    }
    return null;
}

function textoDoFilho(elemento, nomeTag) {
    const filho = primeiroFilhoComNome(elemento, nomeTag);
    return filho ? filho.textContent.trim() : null;
}

function extrairGeometria(placemarkEl) {
    const lineString = placemarkEl.getElementsByTagName("LineString")[0];
    if (lineString) {
        return { tipo: "LineString", pontos: parsearCoordenadas(textoDoFilho(lineString, "coordinates")) };
    }

    const polygon = placemarkEl.getElementsByTagName("Polygon")[0];
    if (polygon) {
        const anelExterno = polygon.getElementsByTagName("outerBoundaryIs")[0];
        const coordsEl = anelExterno?.getElementsByTagName("coordinates")[0];
        return coordsEl ? { tipo: "Polygon", pontos: parsearCoordenadas(coordsEl.textContent.trim()) } : null;
    }

    const point = placemarkEl.getElementsByTagName("Point")[0];
    if (point) {
        return { tipo: "Point", pontos: parsearCoordenadas(textoDoFilho(point, "coordinates")) };
    }

    return null;
}

function parsearCoordenadas(texto) {
    if (!texto) return [];
    return texto
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(tupla => {
            const [lon, lat, alt] = tupla.split(",").map(Number);
            return alt !== undefined ? { lat, lon, alt } : { lat, lon };
        });
}
