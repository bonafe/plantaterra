import { calcularRumoBussola, normalizarGraus } from "../geo/rumo.js";

/**
 * Lê a bússola do aparelho (DeviceOrientation) e emite o rumo — para onde a
 * pessoa está olhando, em graus no sentido horário a partir do norte — a cada
 * leitura. Usado pelo "frente para cima" do modo Andar (docs/especificacao.md
 * secao 14.9). Só leitura de sensor: suavização e uso do rumo ficam com quem chama.
 *
 * Particularidades por plataforma:
 *  - iOS (Safari): exige permissão explícita, que só pode ser pedida dentro de
 *    um toque do usuário (`iniciar()` precisa ser chamado direto do clique), e
 *    fornece o rumo pronto em `webkitCompassHeading`.
 *  - Android (Chrome): sem permissão; o evento `deviceorientationabsolute` traz
 *    os ângulos em relação ao norte magnético.
 *  - Computador: normalmente não há sensor — o evento chega sem valores (ou nem
 *    chega) e `iniciar()` resolve com false.
 */
export class CaptadorRumo extends EventTarget {

    static EVENTO_RUMO = "rumo";

    constructor({ tempoLimiteMs = 1500 } = {}) {
        super();
        this.tempoLimiteMs = tempoLimiteMs;
        this._nomeEvento = null;
        this._aoOrientacao = this._aoOrientacao.bind(this);
    }

    /**
     * Pede permissão (se a plataforma exigir) e começa a ouvir o sensor.
     * Resolve com true assim que chega a primeira leitura válida, ou false se
     * não há bússola utilizável (sem suporte, permissão negada ou sem leitura
     * dentro do tempo limite).
     */
    async iniciar() {
        if (typeof DeviceOrientationEvent === "undefined") return false;

        // Primeiro await da função: ainda dentro do gesto do usuário, como o iOS exige.
        if (typeof DeviceOrientationEvent.requestPermission === "function") {
            try {
                const resposta = await DeviceOrientationEvent.requestPermission();
                if (resposta !== "granted") return false;
            } catch {
                return false;
            }
        }

        this._nomeEvento = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";

        return new Promise(resolve => {
            const limite = setTimeout(() => {
                this.removeEventListener(CaptadorRumo.EVENTO_RUMO, aoPrimeiraLeitura);
                this.parar();
                resolve(false);
            }, this.tempoLimiteMs);

            const aoPrimeiraLeitura = () => {
                clearTimeout(limite);
                this.removeEventListener(CaptadorRumo.EVENTO_RUMO, aoPrimeiraLeitura);
                resolve(true);
            };

            this.addEventListener(CaptadorRumo.EVENTO_RUMO, aoPrimeiraLeitura);
            window.addEventListener(this._nomeEvento, this._aoOrientacao, true);
        });
    }

    parar() {
        if (this._nomeEvento) {
            window.removeEventListener(this._nomeEvento, this._aoOrientacao, true);
            this._nomeEvento = null;
        }
    }

    _aoOrientacao(evento) {
        let rumo = null;

        if (typeof evento.webkitCompassHeading === "number") {
            rumo = evento.webkitCompassHeading;
        } else if (evento.absolute || this._nomeEvento === "deviceorientationabsolute") {
            rumo = calcularRumoBussola(evento.alpha, evento.beta, evento.gamma);
        }

        if (rumo === null || Number.isNaN(rumo)) return;

        // Os ângulos são do aparelho; com a tela girada (modo paisagem) o "para cima" da tela mudou.
        const anguloDaTela = screen.orientation?.angle ?? window.orientation ?? 0;
        this.dispatchEvent(new CustomEvent(CaptadorRumo.EVENTO_RUMO, {
            detail: { graus: normalizarGraus(rumo + anguloDaTela) }
        }));
    }
}
