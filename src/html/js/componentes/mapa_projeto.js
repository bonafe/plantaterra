/**
 * <mapa-projeto>: encapsula o mapa Leaflet e todas as camadas visuais do
 * projeto (perímetro, estações/leituras, curvas de nível, trilha em progresso).
 * Espera que `window.L` (Leaflet) já esteja carregado via <script> global.
 */

const CORES_ISOLINHA = ["#2b6cb0", "#2f855a", "#b7791f", "#c05621", "#9b2c2c", "#553c9a"];

export class MapaProjeto extends HTMLElement {

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;

        this.style.display = "block";
        this.mapa = L.map(this, { zoomControl: true }).setView([-23.0, -47.2], 15);

        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "&copy; colaboradores do OpenStreetMap"
        }).addTo(this.mapa);

        this.camadaPerimetro = L.layerGroup().addTo(this.mapa);
        this.camadaLeituras = L.layerGroup().addTo(this.mapa);
        this.camadaIsolinhas = L.layerGroup().addTo(this.mapa);
        this.camadaTrilhaEmProgresso = L.layerGroup().addTo(this.mapa);

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

    definirPoligonoPerimetro(poligono) {
        this.camadaPerimetro.clearLayers();
        if (!poligono || poligono.length < 3) return;

        const latLngs = poligono.map(p => [p.lat, p.lon]);
        L.polygon(latLngs, { color: "#805ad5", weight: 3, fillOpacity: 0.08 }).addTo(this.camadaPerimetro);
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

    ajustarZoomParaConteudo() {
        const grupos = [this.camadaPerimetro, this.camadaLeituras, this.camadaIsolinhas];
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
