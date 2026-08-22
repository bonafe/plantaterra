import { distanciaMetros } from "../geo/geodesia.js";
import { simplificarTrilha, avaliarFechamento } from "../geo/douglas_peucker.js";

/**
 * Captura contínua de trilha enquanto o usuário caminha pelo perímetro
 * (ver docs/especificacao.md secao 6). Mantém watchPosition ligado, filtra
 * amostras de baixa precisão e saltos isolados de GPS (filtro de medóide em
 * janela deslizante), e só adiciona um ponto confirmado quando a pessoa se
 * moveu o suficiente da última posição registrada, para não acumular ruído
 * parado no mesmo lugar.
 */
export class CaptadorTrilha extends EventTarget {

    static EVENTO_PONTO_ADICIONADO = "ponto_adicionado";
    static EVENTO_POSICAO_ATUAL = "posicao_atual";

    constructor(opcoes = {}) {
        super();
        this.distanciaMinimaMetros = opcoes.distanciaMinimaMetros ?? 3;
        this.precisaoMaxima = opcoes.precisaoMaxima ?? 20;
        this.tamanhoJanelaMedoide = opcoes.tamanhoJanelaMedoide ?? 3;
        this.watchId = null;
        this.pausado = false;
        this.pontosBrutos = [];
        this._janela = [];
        this.amostrasDescartadasPrecisao = 0;
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

                const precisaoOk = ponto.precisao <= this.precisaoMaxima;

                if (precisaoOk) {
                    this.dispatchEvent(new CustomEvent(CaptadorTrilha.EVENTO_POSICAO_ATUAL, { detail: ponto }));
                } else {
                    this.amostrasDescartadasPrecisao++;
                }

                if (this.pausado || !precisaoOk) {
                    return;
                }

                // Filtro de medóide: só confirma um ponto quando ele é corroborado
                // pelas amostras vizinhas na janela, para descartar saltos isolados
                // de GPS (ver docs/especificacao.md secao 6) sem depender de um
                // limiar fixo de velocidade.
                this._janela.push(ponto);
                if (this._janela.length > this.tamanhoJanelaMedoide) {
                    this._janela.shift();
                }
                if (this._janela.length < this.tamanhoJanelaMedoide) {
                    return;
                }

                const candidato = medoide(this._janela);
                const ultimo = this.pontosBrutos[this.pontosBrutos.length - 1];
                const distancia = ultimo
                    ? distanciaMetros(ultimo.lat, ultimo.lon, candidato.lat, candidato.lon)
                    : Infinity;

                if (distancia >= this.distanciaMinimaMetros) {
                    this.pontosBrutos.push(candidato);
                    this.dispatchEvent(new CustomEvent(CaptadorTrilha.EVENTO_PONTO_ADICIONADO, {
                        detail: { ponto: candidato, totalPontos: this.pontosBrutos.length }
                    }));
                }
            },
            erro => this.dispatchEvent(new CustomEvent("erro", { detail: erro })),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    }

    pausar() {
        this.pausado = true;
        this._janela = [];
    }

    retomar() {
        this.pausado = false;
        this._janela = [];
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

/**
 * Escolhe, dentro da janela, a amostra mais "central" (menor soma de
 * distâncias até as outras) — robusto a um salto isolado de GPS na janela,
 * sem depender de um limiar fixo de velocidade.
 */
function medoide(amostras) {
    let melhor = amostras[0];
    let menorSoma = Infinity;

    for (const candidata of amostras) {
        let soma = 0;
        for (const outra of amostras) {
            if (outra !== candidata) {
                soma += distanciaMetros(candidata.lat, candidata.lon, outra.lat, outra.lon);
            }
        }
        if (soma < menorSoma) {
            menorSoma = soma;
            melhor = candidata;
        }
    }

    return melhor;
}
