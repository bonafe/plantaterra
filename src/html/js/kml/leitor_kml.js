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
    const visivel = ehVisivel(raiz);

    return {
        tipo: "pasta",
        nome: textoDoFilho(raiz, "name") ?? "",
        visivel,
        filhos: filhosComoArvore(raiz, visivel)
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

/**
 * @param {Element} elemento
 * @param {boolean} visivelHerdado se algum ancestral já está marcado invisível
 * (`<visibility>0</visibility>`), todos os descendentes herdam isso — o KML
 * guarda a visibilidade que a pessoa configurou no Google Earth, e usamos
 * isso para não trazer conteúdo desligado/antigo na importação.
 */
function filhosComoArvore(elemento, visivelHerdado) {
    const nos = [];
    for (const filho of elemento.children) {
        const nomeTag = filho.localName ?? filho.tagName;

        if (nomeTag === "Folder") {
            const visivel = visivelHerdado && ehVisivel(filho);
            nos.push({
                tipo: "pasta",
                nome: textoDoFilho(filho, "name") ?? "",
                visivel,
                filhos: filhosComoArvore(filho, visivel)
            });
        } else if (nomeTag === "Placemark") {
            nos.push({
                tipo: "placemark",
                nome: textoDoFilho(filho, "name") ?? "",
                visivel: visivelHerdado && ehVisivel(filho),
                geometria: extrairGeometria(filho)
            });
        }
    }
    return nos;
}

function ehVisivel(elemento) {
    return textoDoFilho(elemento, "visibility") !== "0";
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
