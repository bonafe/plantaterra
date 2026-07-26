import { distanciaMetros } from "../geo/geodesia.js";

/**
 * Captura uma coordenada GPS estabilizada (ver docs/especificacao.md secao 5):
 * coleta amostras sucessivas via watchPosition, descarta as de baixa precisão,
 * e conclui quando o desvio das últimas amostras aceitas for pequeno o bastante
 * ou quando o tempo máximo de espera for atingido.
 */
export class CaptadorCoordenada extends EventTarget {

    static EVENTO_AMOSTRA = "amostra";
    static EVENTO_FINALIZADO = "finalizado";

    constructor(opcoes = {}) {
        super();
        this.precisaoMaxima = opcoes.precisaoMaxima ?? 20;
        this.amostrasMinimas = opcoes.amostrasMinimas ?? 5;
        this.desvioPadraoLimiarMetros = opcoes.desvioPadraoLimiarMetros ?? 3;
        this.tempoMaximoMs = opcoes.tempoMaximoMs ?? 15000;

        this.watchId = null;
        this.amostrasAceitas = [];
        this.amostrasDescartadas = 0;
        this._finalizarManualmente = null;
    }

    /**
     * Inicia a captura. Resolve com:
     * { sucesso, motivo, lat, lon, precisao, totalAmostras, amostrasDescartadas }
     * motivo é um de: "estabilizado" | "tempo_esgotado" | "cancelado" | "sem_amostras"
     */
    capturar() {
        return new Promise((resolve, reject) => {
            if (!("geolocation" in navigator)) {
                reject(new Error("Geolocalização não é suportada por este navegador."));
                return;
            }

            this.amostrasAceitas = [];
            this.amostrasDescartadas = 0;

            const finalizar = motivo => {
                if (this.watchId !== null) {
                    navigator.geolocation.clearWatch(this.watchId);
                    this.watchId = null;
                }
                clearTimeout(timeoutId);
                this._finalizarManualmente = null;

                const resultado = this._consolidar(motivo);
                this.dispatchEvent(new CustomEvent(CaptadorCoordenada.EVENTO_FINALIZADO, { detail: resultado }));
                resolve(resultado);
            };

            this._finalizarManualmente = finalizar;

            const timeoutId = setTimeout(() => finalizar("tempo_esgotado"), this.tempoMaximoMs);

            this.watchId = navigator.geolocation.watchPosition(
                posicao => {
                    const amostra = {
                        lat: posicao.coords.latitude,
                        lon: posicao.coords.longitude,
                        precisao: posicao.coords.accuracy,
                        timestamp: posicao.timestamp
                    };

                    const aceita = amostra.precisao <= this.precisaoMaxima;
                    if (aceita) {
                        this.amostrasAceitas.push(amostra);
                    } else {
                        this.amostrasDescartadas++;
                    }

                    this.dispatchEvent(new CustomEvent(CaptadorCoordenada.EVENTO_AMOSTRA, {
                        detail: {
                            amostra,
                            aceita,
                            totalAceitas: this.amostrasAceitas.length,
                            qualidadeSinal: qualidadeSinal(amostra.precisao, this.precisaoMaxima)
                        }
                    }));

                    if (this._estabilizou()) {
                        finalizar("estabilizado");
                    }
                },
                erro => this.dispatchEvent(new CustomEvent("erro", { detail: erro })),
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        });
    }

    /** Aceita o resultado atual mesmo sem ter estabilizado (baixa precisão). */
    aceitarMesmoAssim() {
        if (this._finalizarManualmente) {
            this._finalizarManualmente("aceito_manualmente");
        }
    }

    cancelar() {
        if (this._finalizarManualmente) {
            this._finalizarManualmente("cancelado");
        }
    }

    _estabilizou() {
        if (this.amostrasAceitas.length < this.amostrasMinimas) return false;
        const ultimas = this.amostrasAceitas.slice(-this.amostrasMinimas);
        return desvioPadraoEmMetros(ultimas) <= this.desvioPadraoLimiarMetros;
    }

    _consolidar(motivo) {
        if (this.amostrasAceitas.length === 0) {
            return {
                sucesso: false,
                motivo,
                lat: null,
                lon: null,
                precisao: null,
                totalAmostras: 0,
                amostrasDescartadas: this.amostrasDescartadas
            };
        }

        const media = calcularMedia(this.amostrasAceitas);
        return {
            sucesso: motivo === "estabilizado",
            motivo,
            lat: media.lat,
            lon: media.lon,
            precisao: media.precisao,
            totalAmostras: this.amostrasAceitas.length,
            amostrasDescartadas: this.amostrasDescartadas
        };
    }
}

function calcularMedia(amostras) {
    const soma = amostras.reduce(
        (acc, a) => ({ lat: acc.lat + a.lat, lon: acc.lon + a.lon, precisao: acc.precisao + a.precisao }),
        { lat: 0, lon: 0, precisao: 0 }
    );
    return {
        lat: soma.lat / amostras.length,
        lon: soma.lon / amostras.length,
        precisao: soma.precisao / amostras.length
    };
}

function desvioPadraoEmMetros(amostras) {
    const media = calcularMedia(amostras);
    const distancias = amostras.map(a => distanciaMetros(a.lat, a.lon, media.lat, media.lon));
    const mediaDistancias = distancias.reduce((s, d) => s + d, 0) / distancias.length;
    const variancia = distancias.reduce((s, d) => s + (d - mediaDistancias) ** 2, 0) / distancias.length;
    return Math.sqrt(variancia);
}

function qualidadeSinal(precisao, precisaoMaxima) {
    if (precisao <= 5) return "boa";
    if (precisao <= precisaoMaxima) return "razoavel";
    return "ruim";
}
