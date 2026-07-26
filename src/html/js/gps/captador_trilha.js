import { distanciaMetros } from "../geo/geodesia.js";
import { simplificarTrilha, avaliarFechamento } from "../geo/douglas_peucker.js";

/**
 * Captura contínua de trilha enquanto o usuário caminha pelo perímetro
 * (ver docs/especificacao.md secao 6). Mantém watchPosition ligado e só
 * adiciona um ponto quando a pessoa se moveu o suficiente da última posição
 * registrada, para não acumular ruído parado no mesmo lugar.
 */
export class CaptadorTrilha extends EventTarget {

    static EVENTO_PONTO_ADICIONADO = "ponto_adicionado";
    static EVENTO_POSICAO_ATUAL = "posicao_atual";

    constructor(opcoes = {}) {
        super();
        this.distanciaMinimaMetros = opcoes.distanciaMinimaMetros ?? 3;
        this.watchId = null;
        this.pausado = false;
        this.pontosBrutos = [];
    }

    iniciar() {
        if (!("geolocation" in navigator)) {
            throw new Error("Geolocalização não é suportada por este navegador.");
        }
        if (this.watchId !== null) {
            return;
        }

        this.watchId = navigator.geolocation.watchPosition(
            posicao => {
                const ponto = {
                    lat: posicao.coords.latitude,
                    lon: posicao.coords.longitude,
                    precisao: posicao.coords.accuracy,
                    timestamp: posicao.timestamp
                };

                this.dispatchEvent(new CustomEvent(CaptadorTrilha.EVENTO_POSICAO_ATUAL, { detail: ponto }));

                if (this.pausado) {
                    return;
                }

                const ultimo = this.pontosBrutos[this.pontosBrutos.length - 1];
                const distancia = ultimo ? distanciaMetros(ultimo.lat, ultimo.lon, ponto.lat, ponto.lon) : Infinity;

                if (distancia >= this.distanciaMinimaMetros) {
                    this.pontosBrutos.push(ponto);
                    this.dispatchEvent(new CustomEvent(CaptadorTrilha.EVENTO_PONTO_ADICIONADO, {
                        detail: { ponto, totalPontos: this.pontosBrutos.length }
                    }));
                }
            },
            erro => this.dispatchEvent(new CustomEvent("erro", { detail: erro })),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    }

    pausar() {
        this.pausado = true;
    }

    retomar() {
        this.pausado = false;
    }

    removerUltimoPonto() {
        return this.pontosBrutos.pop();
    }

    parar() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }

    /**
     * Finaliza a captura: simplifica a trilha bruta e avalia se o fechamento
     * do polígono (distância entre primeiro e último ponto) é aceitável.
     */
    concluir(toleranciaSimplificacaoMetros = 2) {
        this.parar();
        const poligono = simplificarTrilha(this.pontosBrutos, toleranciaSimplificacaoMetros);
        const { fechamentoOk, distanciaFechamento } = avaliarFechamento(poligono);

        return {
            pontos_brutos: this.pontosBrutos.slice(),
            poligono,
            fechamentoOk,
            distanciaFechamento
        };
    }
}
