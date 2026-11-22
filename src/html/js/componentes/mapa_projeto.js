/**
 * <mapa-projeto>: encapsula o mapa OpenLayers e todas as camadas visuais do
 * projeto (perímetro, estações/leituras, curvas de nível, trilha em progresso).
 * Espera que `window.ol` (OpenLayers, vendor/openlayers/ol.js) já esteja
 * carregado via <script> global.
 *
 * O resto do app só conversa com os métodos públicos desta classe (em lat/lon);
 * projeções, estilos e features do OpenLayers ficam todos aqui dentro.
 * O mapa gira (dois dedos, ou arrastando com Alt+Shift); o botão de bússola
 * volta ao norte.
 */

const CORES_ISOLINHA = ["#2b6cb0", "#2f855a", "#b7791f", "#c05621", "#9b2c2c", "#553c9a"];

// Gradiente usado para mostrar os pontos brutos de uma trilha do mais antigo
// (azul) ao mais recente (vermelho), ao editar uma rodada de captura.
const COR_GRADIENTE_INICIO = [49, 130, 206]; // #3182ce
const COR_GRADIENTE_FIM = [229, 62, 62]; // #e53e3e

// Folga, em px, para acertar o toque num ponto pequeno com o dedo.
const TOLERANCIA_TOQUE_PX = 8;

function corGradiente(fracao) {
    const [r, g, b] = COR_GRADIENTE_INICIO.map((c, i) => Math.round(c + (COR_GRADIENTE_FIM[i] - c) * fracao));
    return `rgb(${r}, ${g}, ${b})`;
}

/** "#rrggbb" + opacidade -> "rgba(...)". Aceita também "rgb(...)" já pronto (ignora a opacidade). */
function comOpacidade(cor, opacidade = 1) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cor);
    if (!m) return cor;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${opacidade})`;
}

/** lat/lon (graus) -> coordenada do mapa (Web Mercator). */
function paraMapa(lat, lon) {
    return ol.proj.fromLonLat([lon, lat]);
}

function estiloLinha({ cor, largura = 2, opacidade = 1, tracejado = null }) {
    return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: comOpacidade(cor, opacidade), width: largura, lineDash: tracejado })
    });
}

function estiloPoligono({ cor, largura = 2, opacidade = 1, opacidadePreenchimento = 0.08, tracejado = null }) {
    return new ol.style.Style({
        stroke: new ol.style.Stroke({ color: comOpacidade(cor, opacidade), width: largura, lineDash: tracejado }),
        fill: new ol.style.Fill({ color: comOpacidade(cor, opacidadePreenchimento) })
    });
}

/** Equivalente ao "circleMarker" de antes: círculo com raio em pixels (não em metros). */
function estiloCirculo({ raio, cor, largura = 2, corPreenchimento, opacidadePreenchimento = 1, texto = null }) {
    return new ol.style.Style({
        image: new ol.style.Circle({
            radius: raio,
            stroke: new ol.style.Stroke({ color: cor, width: largura }),
            fill: new ol.style.Fill({ color: comOpacidade(corPreenchimento, opacidadePreenchimento) })
        }),
        // O texto não gira com o mapa (rotateWithView é falso por padrão): continua legível.
        text: texto ? new ol.style.Text({
            text: texto,
            offsetY: -(raio + 10),
            font: "bold 13px system-ui, sans-serif",
            fill: new ol.style.Fill({ color: "#1a202c" }),
            stroke: new ol.style.Stroke({ color: "#fff", width: 3 })
        }) : undefined
    });
}

export class MapaProjeto extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.style.display = "block";

        // Uma camada vetorial por tipo de conteúdo; a ordem de criação é a ordem
        // de empilhamento (a última fica por cima), como era com os layerGroup.
        this._zIndex = 1;
        this.camadaContexto = this._criarCamada();
        this.camadaPerimetro = this._criarCamada();
        this.camadaLeituras = this._criarCamada();
        this.camadaIsolinhas = this._criarCamada();
        this.camadaLinhasSaf = this._criarCamada();
        this.camadaLinhaDestacada = this._criarCamada();
        this.camadaSegmentoAtivo = this._criarCamada();
        this.camadaMetrosProximos = this._criarCamada();
        this.camadaPosicaoUsuario = this._criarCamada();
        this.camadaTrilhaEmProgresso = this._criarCamada();
        this.camadaPontosTrilha = this._criarCamada();
        this.camadaPreviaPoligono = this._criarCamada();

        // crossOrigin: null mantém as requisições de tile no modo "no-cors" de
        // sempre (o service worker guarda essas respostas no cache de tiles —
        // sw.js). Com "anonymous" o cache já existente nos aparelhos deixaria
        // de servir. Não lemos pixels do canvas, então não precisamos de CORS.
        const fundo = new ol.layer.Tile({
            zIndex: 0,
            source: new ol.source.OSM({
                crossOrigin: null,
                attributions: ['&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>']
            })
        });

        this.visao = new ol.View({
            center: paraMapa(-23.0, -47.2),
            zoom: 15,
            // O servidor de tiles do OSM vai até o nível 19; acima disso o
            // OpenLayers só amplia a imagem, o que dá zoom suficiente para
            // escolher quadrados de 1 m no modo Andar.
            maxZoom: 22,
            enableRotation: true
        });

        this.mapa = new ol.Map({
            target: this,
            layers: [fundo, ...this._camadas.map(c => c.camada)],
            view: this.visao,
            controls: ol.control.defaults.defaults({
                zoom: true,
                // Bússola: só aparece quando o mapa está girado; tocar volta ao norte.
                rotate: true,
                attribution: true
            })
        });

        this._montarTooltip();

        this._centralizadoAutomaticamente = false;
        this.centralizarNaPosicaoAtual();
    }

    _criarCamada() {
        const fonte = new ol.source.Vector();
        const camada = new ol.layer.Vector({
            source: fonte,
            zIndex: this._zIndex++,
            // Sem isto as camadas vetoriais somem durante gestos/animações (giro, seguir a posição).
            updateWhileAnimating: true,
            updateWhileInteracting: true
        });
        (this._camadas ??= []).push({ camada, fonte });
        return fonte;
    }

    /**
     * Rótulo flutuante ao passar o mouse ou tocar numa feature que tem a
     * propriedade `rotulo`; e clique/toque em features com `aoClicar`.
     */
    _montarTooltip() {
        const elemento = document.createElement("div");
        elemento.className = "tooltip-mapa";
        elemento.hidden = true;
        this._overlayTooltip = new ol.Overlay({
            element: elemento,
            offset: [0, -14],
            positioning: "bottom-center",
            stopEvent: false
        });
        this.mapa.addOverlay(this._overlayTooltip);
        this._elementoTooltip = elemento;

        const featureNoPixel = pixel => {
            let alvo = null;
            this.mapa.forEachFeatureAtPixel(pixel, feature => {
                if (feature.get("aoClicar") || feature.get("rotulo")) {
                    alvo = feature;
                    return true;
                }
                return false;
            }, { hitTolerance: TOLERANCIA_TOQUE_PX });
            return alvo;
        };

        const mostrar = (feature, coordenada) => {
            const rotulo = feature?.get("rotulo");
            if (!rotulo) {
                elemento.hidden = true;
                return;
            }
            elemento.textContent = rotulo;
            elemento.hidden = false;
            this._overlayTooltip.setPosition(coordenada);
        };

        this.mapa.on("click", evento => {
            const feature = featureNoPixel(evento.pixel);
            feature?.get("aoClicar")?.();
            mostrar(feature, evento.coordinate);
        });

        // Mouse: o rótulo aparece ao passar por cima. No toque não há "passar por
        // cima" — lá vale o rótulo do toque (evento "click" acima).
        this.mapa.on("pointermove", evento => {
            if (evento.dragging || evento.originalEvent.pointerType !== "mouse") return;
            const feature = featureNoPixel(evento.pixel);
            this.mapa.getTargetElement().style.cursor = feature?.get("aoClicar") ? "pointer" : "";
            mostrar(feature, evento.coordinate);
        });
    }

    _adicionar(fonte, geometria, estilo, propriedades = {}) {
        const feature = new ol.Feature({ geometry: geometria, ...propriedades });
        feature.setStyle(estilo);
        fonte.addFeature(feature);
        return feature;
    }

    /** Linha (ou anel de polígono) a partir de uma lista de {lat, lon}. */
    _coordenadas(pontos) {
        return pontos.map(p => paraMapa(p.lat, p.lon));
    }

    _anel(pontos) {
        const coordenadas = this._coordenadas(pontos);
        coordenadas.push(coordenadas[0]);
        return coordenadas;
    }

    centralizarNaPosicaoAtual() {
        if (!("geolocation" in navigator)) return;
        navigator.geolocation.getCurrentPosition(
            posicao => {
                //O projeto manda: se o mapa já foi enquadrado no conteúdo (perímetro, linhas...), o GPS não mexe
                if (!this._centralizadoAutomaticamente) {
                    this.visao.setCenter(paraMapa(posicao.coords.latitude, posicao.coords.longitude));
                    this.visao.setZoom(17);
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
        this.camadaContexto.clear();

        for (const elemento of elementos) {
            const propriedades = { rotulo: elemento.nome };

            if (elemento.tipo === "Point") {
                const p = elemento.geometria[0];
                this._adicionar(this.camadaContexto, new ol.geom.Point(paraMapa(p.lat, p.lon)),
                    estiloCirculo({ raio: 4, cor: "#718096", largura: 1, corPreenchimento: "#a0aec0", opacidadePreenchimento: 0.8 }),
                    propriedades);
            } else if (elemento.tipo === "LineString") {
                this._adicionar(this.camadaContexto, new ol.geom.LineString(this._coordenadas(elemento.geometria)),
                    estiloLinha({ cor: "#718096", largura: 2, opacidade: 0.7, tracejado: [4, 4] }), propriedades);
            } else if (elemento.tipo === "Polygon") {
                this._adicionar(this.camadaContexto, new ol.geom.Polygon([this._anel(elemento.geometria)]),
                    estiloPoligono({ cor: "#718096", largura: 2, opacidade: 0.7, opacidadePreenchimento: 0.08 }), propriedades);
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
        this.camadaPerimetro.clear();

        trilhas.forEach((trilha, indice) => {
            if (!trilha.poligono || trilha.poligono.length < 3) return;

            const cor = trilha.ativo ? "#805ad5" : CORES_ISOLINHA[indice % CORES_ISOLINHA.length];
            this._adicionar(this.camadaPerimetro, new ol.geom.Polygon([this._anel(trilha.poligono)]),
                estiloPoligono({ cor, largura: trilha.ativo ? 3 : 2, opacidadePreenchimento: 0.08 }),
                { rotulo: trilha.nome || "Perímetro" });
        });
    }

    definirEstacoesELeituras(estacoesComLeituras) {
        this.camadaLeituras.clear();

        estacoesComLeituras.forEach(({ estacao, leituras }, indiceEstacao) => {
            const cor = CORES_ISOLINHA[indiceEstacao % CORES_ISOLINHA.length];

            this._adicionar(this.camadaLeituras,
                new ol.geom.Point(paraMapa(estacao.coordenada.lat, estacao.coordenada.lon)),
                estiloCirculo({ raio: 9, cor, largura: 3, corPreenchimento: "#ffffff" }),
                { rotulo: `${estacao.nome} (instrumento)` });

            leituras.forEach(leitura => {
                const rotulo = leitura.altitude_relativa !== null
                    ? `${leitura.altitude_relativa.toFixed(2)} m`
                    : "sem altitude";

                this._adicionar(this.camadaLeituras,
                    new ol.geom.Point(paraMapa(leitura.coordenada.lat, leitura.coordenada.lon)),
                    estiloCirculo({
                        raio: 5, cor, largura: 2, corPreenchimento: cor,
                        opacidadePreenchimento: leitura.eh_ponto_amarracao ? 1 : 0.6
                    }),
                    { rotulo: `${estacao.nome}: ${rotulo}${leitura.eh_ponto_amarracao ? " (amarração)" : ""}` });
            });
        });
    }

    definirIsolinhas(isolinhas) {
        this.camadaIsolinhas.clear();

        isolinhas.forEach(({ nivel, pontos }, indice) => {
            const estilo = estiloLinha({ cor: CORES_ISOLINHA[indice % CORES_ISOLINHA.length], largura: 2 });
            pontos.forEach(([p1, p2]) => {
                this._adicionar(this.camadaIsolinhas, new ol.geom.LineString(this._coordenadas([p1, p2])),
                    estilo, { rotulo: `${nivel.toFixed(2)} m` });
            });
        });
    }

    definirLinhasSaf(safsComLinhas) {
        this.camadaLinhasSaf.clear();

        safsComLinhas.forEach(({ saf, linhas }, indiceSaf) => {
            const estilo = estiloLinha({ cor: CORES_ISOLINHA[indiceSaf % CORES_ISOLINHA.length], largura: 3, opacidade: 0.7 });

            linhas.forEach(linha => {
                this._adicionar(this.camadaLinhasSaf, new ol.geom.LineString(this._coordenadas(linha.geometria)),
                    estilo, { rotulo: `${saf.nome}: ${linha.nome_original}` });
            });
        });
    }

    /**
     * Destaca um conjunto de linhas (as linhas de um SAF inteiro, durante a
     * edição de plantas na matriz) com um marcador em cada metro que já tem
     * planta cadastrada.
     */
    destacarLinhas(partes, { ajustarZoom = true } = {}) {
        this.camadaLinhaDestacada.clear();

        const todasAsCoordenadas = [];
        const estiloDaLinha = estiloLinha({ cor: "#e53e3e", largura: 5 });
        const estiloPlantado = estiloCirculo({ raio: 6, cor: "#e53e3e", largura: 2, corPreenchimento: "#ffffff" });

        partes.forEach(({ linha, pontosPlantados }) => {
            const coordenadas = this._coordenadas(linha.geometria);
            todasAsCoordenadas.push(...coordenadas);

            const rotuloLinha = linha.numero_linha !== null ? `Linha ${linha.numero_linha}` : linha.nome_original;
            this._adicionar(this.camadaLinhaDestacada, new ol.geom.LineString(coordenadas), estiloDaLinha, { rotulo: rotuloLinha });

            pontosPlantados.forEach(({ indiceMetro, coordenada, plantas }) => {
                this._adicionar(this.camadaLinhaDestacada,
                    new ol.geom.Point(paraMapa(coordenada.lat, coordenada.lon)), estiloPlantado,
                    { rotulo: `${rotuloLinha} · metro ${indiceMetro}: ${plantas.map(p => p.especie).join(", ")}` });
            });
        });

        if (ajustarZoom && todasAsCoordenadas.length) {
            this._enquadrar(ol.extent.boundingExtent(todasAsCoordenadas), 40);
        }
    }

    limparLinhasDestacadas() {
        this.camadaLinhaDestacada.clear();
        this.camadaSegmentoAtivo.clear();
    }

    /**
     * Destaca o metro específico que está sendo editado (célula clicada na
     * matriz) com um marcador diferenciado e o rótulo "Linha X · metro N", e
     * centraliza o mapa nele. Com `zoomMinimo` aproxima se estiver mais afastado
     * (nunca afasta): um metro tem ~15 px no zoom 21, o suficiente para ver
     * exatamente onde ele fica na linha.
     */
    destacarSegmentoAtivo(coordenada, { rotulo = null, zoomMinimo = null } = {}) {
        this.camadaSegmentoAtivo.clear();

        const centro = paraMapa(coordenada.lat, coordenada.lon);
        this._adicionar(this.camadaSegmentoAtivo, new ol.geom.Point(centro),
            estiloCirculo({ raio: 11, cor: "#b7791f", largura: 3, corPreenchimento: "#f6e05e", opacidadePreenchimento: 0.7, texto: rotulo }));

        const zoomAtual = this.visao.getZoom();
        const zoom = zoomMinimo === null ? zoomAtual : Math.max(zoomAtual, zoomMinimo);
        this.visao.animate({ center: centro, zoom, duration: 250 });
    }

    // ---- Modo "Andar na agrofloresta" (docs/especificacao.md secao 14.9) ----

    /** Ponto azul na posição do GPS, com um círculo do tamanho da precisão informada. */
    definirPosicaoUsuario({ lat, lon, precisao }) {
        this.camadaPosicaoUsuario.clear();
        if (Number.isFinite(precisao)) {
            // Círculo em metros reais (geodésico), não em unidades do Mercator.
            const circulo = ol.geom.Polygon.circular([lon, lat], precisao, 64).transform("EPSG:4326", "EPSG:3857");
            this._adicionar(this.camadaPosicaoUsuario, circulo, estiloPoligono({ cor: "#3182ce", largura: 1, opacidadePreenchimento: 0.12 }));
        }
        this._adicionar(this.camadaPosicaoUsuario, new ol.geom.Point(paraMapa(lat, lon)),
            estiloCirculo({ raio: 8, cor: "#ffffff", largura: 3, corPreenchimento: "#3182ce" }));
    }

    /**
     * Desenha os metros candidatos (perto da posição) em bolinhas; o
     * selecionado fica amarelo, maior e leva o número. `aoTocar(chave)` é
     * chamado ao tocar num deles. Cada item: { chave, indiceMetro, coordenada, plantado }.
     */
    definirMetrosProximos(itens, chaveSelecionada, aoTocar) {
        this.camadaMetrosProximos.clear();
        itens.forEach(item => {
            const selecionado = item.chave === chaveSelecionada;
            // Metros ficam a 1 m um do outro (~15 px no zoom 21): bolinhas pequenas
            // para não se sobreporem; só o selecionado é maior e leva o número
            // (os números de todos estão nos botões do painel).
            this._adicionar(this.camadaMetrosProximos,
                new ol.geom.Point(paraMapa(item.coordenada.lat, item.coordenada.lon)),
                estiloCirculo({
                    raio: selecionado ? 9 : 5,
                    cor: selecionado ? "#b7791f" : "#e53e3e",
                    largura: selecionado ? 3 : 2,
                    corPreenchimento: selecionado ? "#f6e05e" : (item.plantado ? "#68d391" : "#ffffff"),
                    opacidadePreenchimento: 0.95,
                    texto: selecionado ? String(item.indiceMetro) : null
                }),
                { aoClicar: () => aoTocar(item.chave) });
        });
    }

    limparModoAndar() {
        this.camadaPosicaoUsuario.clear();
        this.camadaMetrosProximos.clear();
    }

    /**
     * Centraliza na posição. Com `zoomMinimo`, aproxima se estiver mais
     * afastado que isso (usado só no primeiro sinal); sem ele, respeita o
     * zoom que a pessoa escolheu. Não mexe na rotação.
     */
    seguirPosicao(lat, lon, zoomMinimo = null) {
        const zoomAtual = this.visao.getZoom();
        const zoom = zoomMinimo === null ? zoomAtual : Math.max(zoomAtual, zoomMinimo);
        this.visao.animate({ center: paraMapa(lat, lon), zoom, duration: 250 });
    }

    /** Avisa quando a pessoa arrasta o mapa com o dedo (para pausar o "seguir"). */
    aoArrastarManualmente(callback) {
        this.mapa.on("pointerdrag", callback);
    }

    /**
     * Gira o mapa para que `graus` (rumo da bússola: 0 = norte, 90 = leste)
     * fique para cima — "frente para cima". Sem animação: quem chama já
     * suaviza o rumo, e animar a cada leitura do sensor atrasaria o giro.
     */
    girarParaRumo(graus) {
        this.visao.setRotation(-graus * Math.PI / 180);
    }

    /**
     * Enquanto o mapa gira sozinho (frente para cima), o giro com os dedos e a
     * bússola de "voltar ao norte" ficam desligados — brigariam com o sensor.
     * Ao desligar, o mapa volta ao norte.
     */
    definirRotacaoAutomatica(ativa) {
        this.classList.toggle("rotacao-automatica", ativa);
        this.mapa.getInteractions().forEach(interacao => {
            if (interacao instanceof ol.interaction.PinchRotate || interacao instanceof ol.interaction.DragRotate) {
                interacao.setActive(!ativa);
            }
        });
        if (!ativa) {
            this.visao.animate({ rotation: 0, duration: 300 });
        }
    }

    iniciarTrilhaEmProgresso() {
        this.camadaTrilhaEmProgresso.clear();
        this._linhaTrilhaEmProgresso = this._adicionar(this.camadaTrilhaEmProgresso,
            new ol.geom.LineString([]), estiloLinha({ cor: "#e53e3e", largura: 4 }));
        this._marcadorPosicaoAtual = new ol.Feature({ geometry: new ol.geom.Point([0, 0]) });
        this._marcadorPosicaoAtual.setStyle(estiloCirculo({ raio: 7, cor: "#e53e3e", largura: 2, corPreenchimento: "#e53e3e" }));
    }

    atualizarTrilhaEmProgresso(pontos) {
        if (!this._linhaTrilhaEmProgresso) return;
        this._linhaTrilhaEmProgresso.getGeometry().setCoordinates(this._coordenadas(pontos));
    }

    atualizarPosicaoAtual(lat, lon) {
        if (!this._marcadorPosicaoAtual) return;
        const posicao = paraMapa(lat, lon);
        this._marcadorPosicaoAtual.getGeometry().setCoordinates(posicao);
        if (!this.camadaTrilhaEmProgresso.hasFeature(this._marcadorPosicaoAtual)) {
            this.camadaTrilhaEmProgresso.addFeature(this._marcadorPosicaoAtual);
        }
        this.visao.animate({ center: posicao, duration: 200 });
    }

    pararTrilhaEmProgresso() {
        this.camadaTrilhaEmProgresso.clear();
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
        this.camadaPontosTrilha.clear();
        if (!pontos.length) return;

        const inicio = tMin ?? pontos[0].timestamp;
        const fim = tMax ?? pontos[pontos.length - 1].timestamp;
        const amplitude = fim - inicio || 1;

        pontos.forEach((ponto, indice) => {
            const fracao = Math.min(1, Math.max(0, (ponto.timestamp - inicio) / amplitude));
            const cor = corGradiente(fracao);
            const selecionado = indice === indiceSelecionado;

            this._adicionar(this.camadaPontosTrilha, new ol.geom.Point(paraMapa(ponto.lat, ponto.lon)),
                estiloCirculo({
                    // Raio generoso para toque (o alvo de 6px original era bom
                    // para mouse, mas pequeno demais para dedo — mínimo
                    // recomendado de toque é ~44px de diâmetro).
                    raio: selecionado ? 17 : 11,
                    cor: selecionado ? "#1a202c" : cor,
                    largura: selecionado ? 3 : 2,
                    corPreenchimento: cor,
                    opacidadePreenchimento: 0.9
                }),
                {
                    aoClicar: () => {
                        this.dispatchEvent(new CustomEvent("ponto-trilha-clicado", { detail: { indice } }));
                    }
                });
        });

        if (ajustarZoom) {
            this._enquadrar(ol.extent.boundingExtent(pontos.map(p => paraMapa(p.lat, p.lon))), 30);
        }
    }

    limparPontosTrilhaEditavel() {
        this.camadaPontosTrilha.clear();
    }

    /**
     * Prévia (tracejada) de um polígono candidato ainda não salvo — usada no
     * editor de pontos quando o projeto é marcado como terreno convexo, para
     * mostrar o casco convexo resultante antes de confirmar o salvamento.
     */
    definirPreviaPoligono(poligono) {
        this.camadaPreviaPoligono.clear();
        if (!poligono || poligono.length < 3) return;

        this._adicionar(this.camadaPreviaPoligono, new ol.geom.Polygon([this._anel(poligono)]),
            estiloPoligono({ cor: "#38a169", largura: 2, tracejado: [6, 4], opacidadePreenchimento: 0.05 }));
    }

    limparPreviaPoligono() {
        this.camadaPreviaPoligono.clear();
    }

    /** Enquadra uma extensão (coordenadas do mapa) com folga em px; mantém a rotação atual. */
    _enquadrar(extensao, folgaPx) {
        if (ol.extent.isEmpty(extensao)) return;
        this.visao.fit(extensao, {
            padding: [folgaPx, folgaPx, folgaPx, folgaPx],
            maxZoom: 20,
            duration: 0
        });
    }

    ajustarZoomParaConteudo() {
        const extensao = ol.extent.createEmpty();
        [this.camadaPerimetro, this.camadaLeituras, this.camadaIsolinhas, this.camadaLinhasSaf].forEach(fonte => {
            if (fonte.getFeatures().length > 0) ol.extent.extend(extensao, fonte.getExtent());
        });
        if (ol.extent.isEmpty(extensao)) {
            //Sem perímetro nem leituras: o contexto (KMZ importado) ainda diz onde fica a propriedade
            if (this.camadaContexto.getFeatures().length > 0) ol.extent.extend(extensao, this.camadaContexto.getExtent());
        }
        if (!ol.extent.isEmpty(extensao)) {
            this._enquadrar(extensao, 30);
            //Enquadrou a propriedade inteira: a posição do GPS, que chega depois, não pode sobrescrever
            this._centralizadoAutomaticamente = true;
        }
    }

    invalidarTamanho() {
        this.mapa?.updateSize();
    }
}

customElements.define("mapa-projeto", MapaProjeto);
