/**
 * <mapa-projeto>: encapsula o mapa Leaflet e todas as camadas visuais do
 * projeto (perímetro, estações/leituras, curvas de nível, trilha em progresso).
 * Espera que `window.L` (Leaflet) já esteja carregado via <script> global.
 */

const CORES_ISOLINHA = ["#2b6cb0", "#2f855a", "#b7791f", "#c05621", "#9b2c2c", "#553c9a"];

// Gradiente usado para mostrar os pontos brutos de uma trilha do mais antigo
// (azul) ao mais recente (vermelho), ao editar uma rodada de captura.
const COR_GRADIENTE_INICIO = [49, 130, 206]; // #3182ce
const COR_GRADIENTE_FIM = [229, 62, 62]; // #e53e3e

function corGradiente(fracao) {
    const [r, g, b] = COR_GRADIENTE_INICIO.map((c, i) => Math.round(c + (COR_GRADIENTE_FIM[i] - c) * fracao));
    return `rgb(${r}, ${g}, ${b})`;
}

export class MapaProjeto extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.style.display = "block";
        this.mapa = L.map(this, { zoomControl: true, maxZoom: 22 }).setView([-23.0, -47.2], 15);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 22,
            maxNativeZoom: 19,
            attribution: "&copy; colaboradores do OpenStreetMap"
        }).addTo(this.mapa);

        this.camadaContexto = L.layerGroup().addTo(this.mapa);
        this.camadaPerimetro = L.layerGroup().addTo(this.mapa);
        this.camadaLeituras = L.layerGroup().addTo(this.mapa);
        this.camadaIsolinhas = L.layerGroup().addTo(this.mapa);
        this.camadaLinhasSaf = L.layerGroup().addTo(this.mapa);
        this.camadaLinhaDestacada = L.layerGroup().addTo(this.mapa);
        this.camadaSegmentoAtivo = L.layerGroup().addTo(this.mapa);
        this.camadaTrilhaEmProgresso = L.layerGroup().addTo(this.mapa);
        this.camadaPontosTrilha = L.layerGroup().addTo(this.mapa);
        this.camadaPreviaPoligono = L.layerGroup().addTo(this.mapa);

        this._centralizadoAutomaticamente = false;
        this.centralizarNaPosicaoAtual();
    }

    centralizarNaPosicaoAtual() {
        if (!("geolocation" in navigator)) return;
        navigator.geolocation.getCurrentPosition(
            posicao => {
                if (!this._centralizadoAutomaticamente) {
                    this.mapa.setView([posicao.coords.latitude, posicao.coords.longitude], 17);
                    this._centralizadoAutomaticamente = true;
                }
            },
            () => {},
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }

    /**
     * Elementos de contexto (casas, cercas, ruas etc — ver docs/especificacao.md
     * secao 14.8) desenhados em cinza neutro, por baixo das demais camadas,
     * só para ajudar a situar a propriedade — não são interativos.
     */
    definirElementosContexto(elementos) {
        this.camadaContexto.clearLayers();

        for (const elemento of elementos) {
            const latLngs = elemento.geometria.map(p => [p.lat, p.lon]);

            if (elemento.tipo === "Point") {
                L.circleMarker(latLngs[0], {
                    radius: 4,
                    color: "#718096",
                    weight: 1,
                    fillColor: "#a0aec0",
                    fillOpacity: 0.8
                })
                    .bindTooltip(elemento.nome)
                    .addTo(this.camadaContexto);
            } else if (elemento.tipo === "LineString") {
                L.polyline(latLngs, { color: "#718096", weight: 2, opacity: 0.7, dashArray: "4 4" })
                    .bindTooltip(elemento.nome)
                    .addTo(this.camadaContexto);
            } else if (elemento.tipo === "Polygon") {
                L.polygon(latLngs, { color: "#718096", weight: 2, opacity: 0.7, fillOpacity: 0.08 })
                    .bindTooltip(elemento.nome)
                    .addTo(this.camadaContexto);
            }
        }
    }

    /**
     * Desenha todos os perímetros marcados como visíveis — podem ser vários
     * ao mesmo tempo (ex: a propriedade toda + uma área interna, como uma
     * horta). O perímetro principal do projeto (trilha.ativo) mantém a cor
     * roxa de sempre; os demais usam a paleta compartilhada, um rótulo
     * (nome da rodada) por polígono, no mesmo padrão de definirLinhasSaf.
     */
    definirPerimetros(trilhas) {
        this.camadaPerimetro.clearLayers();

        trilhas.forEach((trilha, indice) => {
            if (!trilha.poligono || trilha.poligono.length < 3) return;

            const latLngs = trilha.poligono.map(p => [p.lat, p.lon]);
            const cor = trilha.ativo ? "#805ad5" : CORES_ISOLINHA[indice % CORES_ISOLINHA.length];
            const nome = trilha.nome || "Perímetro";

            L.polygon(latLngs, { color: cor, weight: trilha.ativo ? 3 : 2, fillOpacity: 0.08 })
                .bindTooltip(nome)
                .addTo(this.camadaPerimetro);
        });
    }

    definirEstacoesELeituras(estacoesComLeituras) {
        this.camadaLeituras.clearLayers();

        estacoesComLeituras.forEach(({ estacao, leituras }, indiceEstacao) => {
            const cor = CORES_ISOLINHA[indiceEstacao % CORES_ISOLINHA.length];

            L.circleMarker([estacao.coordenada.lat, estacao.coordenada.lon], {
                radius: 9,
                color: cor,
                weight: 3,
                fillColor: "#fff",
                fillOpacity: 1
            })
                .bindTooltip(`${estacao.nome} (instrumento)`)
                .addTo(this.camadaLeituras);

            leituras.forEach(leitura => {
                const rotulo = leitura.altitude_relativa !== null
                    ? `${leitura.altitude_relativa.toFixed(2)} m`
                    : "sem altitude";

                L.circleMarker([leitura.coordenada.lat, leitura.coordenada.lon], {
                    radius: 5,
                    color: cor,
                    weight: 2,
                    fillColor: cor,
                    fillOpacity: leitura.eh_ponto_amarracao ? 1 : 0.6
                })
                    .bindTooltip(`${estacao.nome}: ${rotulo}${leitura.eh_ponto_amarracao ? " (amarração)" : ""}`)
                    .addTo(this.camadaLeituras);
            });
        });
    }

    definirIsolinhas(isolinhas) {
        this.camadaIsolinhas.clearLayers();

        isolinhas.forEach(({ nivel, pontos }, indice) => {
            const cor = CORES_ISOLINHA[indice % CORES_ISOLINHA.length];
            pontos.forEach(([p1, p2]) => {
                L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], { color: cor, weight: 2 })
                    .bindTooltip(`${nivel.toFixed(2)} m`)
                    .addTo(this.camadaIsolinhas);
            });
        });
    }

    definirLinhasSaf(safsComLinhas) {
        this.camadaLinhasSaf.clearLayers();

        safsComLinhas.forEach(({ saf, linhas }, indiceSaf) => {
            const cor = CORES_ISOLINHA[indiceSaf % CORES_ISOLINHA.length];

            linhas.forEach(linha => {
                const latLngs = linha.geometria.map(p => [p.lat, p.lon]);
                L.polyline(latLngs, { color: cor, weight: 3, opacity: 0.7 })
                    .bindTooltip(`${saf.nome}: ${linha.nome_original}`)
                    .addTo(this.camadaLinhasSaf);
            });
        });
    }

    /**
     * Destaca um conjunto de linhas (as linhas de um SAF inteiro, durante a
     * edição de plantas na matriz) com um marcador em cada metro que já tem
     * planta cadastrada.
     */
    destacarLinhas(partes) {
        this.camadaLinhaDestacada.clearLayers();

        const todosOsPontos = [];

        partes.forEach(({ linha, pontosPlantados }) => {
            const latLngs = linha.geometria.map(p => [p.lat, p.lon]);
            todosOsPontos.push(...latLngs);

            const rotuloLinha = linha.numero_linha !== null ? `Linha ${linha.numero_linha}` : linha.nome_original;
            L.polyline(latLngs, { color: "#e53e3e", weight: 5 })
                .bindTooltip(rotuloLinha)
                .addTo(this.camadaLinhaDestacada);

            pontosPlantados.forEach(({ indiceMetro, coordenada, plantas }) => {
                L.circleMarker([coordenada.lat, coordenada.lon], {
                    radius: 6,
                    color: "#e53e3e",
                    fillColor: "#fff",
                    weight: 2,
                    fillOpacity: 1
                })
                    .bindTooltip(`${rotuloLinha} · metro ${indiceMetro}: ${plantas.map(p => p.especie).join(", ")}`)
                    .addTo(this.camadaLinhaDestacada);
            });
        });

        const bounds = L.latLngBounds(todosOsPontos);
        if (bounds.isValid()) {
            this.mapa.fitBounds(bounds, { padding: [40, 40] });
        }
    }

    limparLinhasDestacadas() {
        this.camadaLinhaDestacada.clearLayers();
        this.camadaSegmentoAtivo.clearLayers();
    }

    /**
     * Destaca o metro específico que está sendo editado (célula clicada na
     * matriz) com um marcador diferenciado, e centraliza o mapa nele — sem
     * mudar o zoom, para manter a noção de onde ele fica dentro da linha.
     */
    destacarSegmentoAtivo(coordenada) {
        this.camadaSegmentoAtivo.clearLayers();

        L.circleMarker([coordenada.lat, coordenada.lon], {
            radius: 11,
            color: "#f6e05e",
            weight: 3,
            fillColor: "#f6e05e",
            fillOpacity: 0.5
        }).addTo(this.camadaSegmentoAtivo);

        this.mapa.panTo([coordenada.lat, coordenada.lon]);
    }

    iniciarTrilhaEmProgresso() {
        this.camadaTrilhaEmProgresso.clearLayers();
        this._linhaTrilhaEmProgresso = L.polyline([], { color: "#e53e3e", weight: 4 }).addTo(this.camadaTrilhaEmProgresso);
        this._marcadorPosicaoAtual = L.circleMarker([0, 0], { radius: 7, color: "#e53e3e", fillColor: "#e53e3e", fillOpacity: 1 });
    }

    atualizarTrilhaEmProgresso(pontos) {
        if (!this._linhaTrilhaEmProgresso) return;
        this._linhaTrilhaEmProgresso.setLatLngs(pontos.map(p => [p.lat, p.lon]));
    }

    atualizarPosicaoAtual(lat, lon) {
        if (!this._marcadorPosicaoAtual) return;
        this._marcadorPosicaoAtual.setLatLng([lat, lon]);
        if (!this.camadaTrilhaEmProgresso.hasLayer(this._marcadorPosicaoAtual)) {
            this._marcadorPosicaoAtual.addTo(this.camadaTrilhaEmProgresso);
        }
        this.mapa.panTo([lat, lon]);
    }

    pararTrilhaEmProgresso() {
        this.camadaTrilhaEmProgresso.clearLayers();
        this._linhaTrilhaEmProgresso = null;
        this._marcadorPosicaoAtual = null;
    }

    /**
     * Mostra os pontos brutos de uma trilha já salva para edição: um círculo
     * por ponto, em gradiente do mais antigo (azul) ao mais recente
     * (vermelho), clicável para selecionar (dispara "ponto-trilha-clicado"
     * com { indice }). `tMin`/`tMax` fixam a escala do gradiente no intervalo
     * de tempo original da captura, para as cores não mudarem ao excluir
     * pontos durante a edição.
     */
    exibirPontosTrilhaEditavel(pontos, { indiceSelecionado = null, tMin, tMax, ajustarZoom = false } = {}) {
        this.camadaPontosTrilha.clearLayers();
        if (!pontos.length) return;

        const inicio = tMin ?? pontos[0].timestamp;
        const fim = tMax ?? pontos[pontos.length - 1].timestamp;
        const amplitude = fim - inicio || 1;

        pontos.forEach((ponto, indice) => {
            const fracao = Math.min(1, Math.max(0, (ponto.timestamp - inicio) / amplitude));
            const cor = corGradiente(fracao);
            const selecionado = indice === indiceSelecionado;

            L.circleMarker([ponto.lat, ponto.lon], {
                // Raio generoso para toque (o alvo de 6px original era bom
                // para mouse, mas pequeno demais para dedo — mínimo
                // recomendado de toque é ~44px de diâmetro).
                radius: selecionado ? 17 : 11,
                color: selecionado ? "#1a202c" : cor,
                weight: selecionado ? 3 : 2,
                fillColor: cor,
                fillOpacity: 0.9
            })
                .on("click", () => {
                    this.dispatchEvent(new CustomEvent("ponto-trilha-clicado", { detail: { indice } }));
                })
                .addTo(this.camadaPontosTrilha);
        });

        if (ajustarZoom) {
            const bounds = L.latLngBounds(pontos.map(p => [p.lat, p.lon]));
            if (bounds.isValid()) this.mapa.fitBounds(bounds, { padding: [30, 30] });
        }
    }

    limparPontosTrilhaEditavel() {
        this.camadaPontosTrilha.clearLayers();
    }

    /**
     * Prévia (tracejada) de um polígono candidato ainda não salvo — usada no
     * editor de pontos quando o projeto é marcado como terreno convexo, para
     * mostrar o casco convexo resultante antes de confirmar o salvamento.
     */
    definirPreviaPoligono(poligono) {
        this.camadaPreviaPoligono.clearLayers();
        if (!poligono || poligono.length < 3) return;

        const latLngs = poligono.map(p => [p.lat, p.lon]);
        L.polygon(latLngs, { color: "#38a169", weight: 2, dashArray: "6 4", fillOpacity: 0.05 }).addTo(this.camadaPreviaPoligono);
    }

    limparPreviaPoligono() {
        this.camadaPreviaPoligono.clearLayers();
    }

    ajustarZoomParaConteudo() {
        const grupos = [this.camadaPerimetro, this.camadaLeituras, this.camadaIsolinhas, this.camadaLinhasSaf];
        const bounds = L.latLngBounds([]);
        grupos.forEach(grupo => {
            grupo.eachLayer(camada => {
                if (camada.getBounds) bounds.extend(camada.getBounds());
                else if (camada.getLatLng) bounds.extend(camada.getLatLng());
            });
        });
        if (bounds.isValid()) {
            this.mapa.fitBounds(bounds, { padding: [30, 30] });
        }
    }

    invalidarTamanho() {
        this.mapa?.invalidateSize();
    }
}

customElements.define("mapa-projeto", MapaProjeto);
