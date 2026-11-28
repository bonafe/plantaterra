import { encontrarMetrosProximos, raioDeBuscaM } from "../geo/proximidade_metros.js";
import { diferencaAngular, suavizarAngulo } from "../geo/rumo.js";
import { CaptadorRumo } from "../gps/captador_rumo.js";

/**
 * <andar-gps>: GPS ao vivo + "frente para cima" para andar pelas fileiras
 * (docs/especificacao.md secao 14.9). Mostra a faixa de estado e os botões
 * "Voltar a seguir" e "Girar com você"; não conhece mapa nem matriz — quem usa
 * liga os eventos.
 *
 * Entrada:
 *   quadrados = [{ chave, coordenada:{lat,lon}, ... }]  metros candidatos (todos os SAFs)
 *   iniciar() / parar()                                 GPS só liga por pedido (bateria)
 *   assumirControle()                                   a pessoa pegou o controle: pausa o "seguir"
 *   seguindo / ativo                                    leitura do estado
 *
 * Eventos (CustomEvent):
 *   "posicao"      detail { posicao:{lat,lon,precisao}, proximos[], maisProximo, distanciaM, seguindo,
 *                           atuando (seguindo e a ≤ RAIO_ATUAR_M de uma fileira),
 *                           centralizar (novo sinal ou retomada), primeiroSinal }
 *   "rumo"         detail { graus }          rumo suavizado já para aplicar no mapa
 *   "rumo-ativo"   detail { ativo }          liga/desliga a rotação automática do mapa
 */
export class AndarGps extends HTMLElement {

    static RAIO_ATUAR_M = 25; // mais longe que isso, a pessoa não está "em" nenhuma fileira
    static VELOCIDADE_MINIMA_GPS_MS = 0.7; // abaixo disso o rumo do GPS é ruído
    static FATOR_SUAVIZACAO = 0.25;
    static INTERVALO_MINIMO_MS = 100;
    static MUDANCA_MINIMA_GRAUS = 2;

    connectedCallback() {
        if (this._inicializado) return;
        this._inicializado = true;
        this._quadrados = [];
        this._estado = null;

        this.hidden = true;
        this.classList.add("andar-faixa");
        this.innerHTML = `
            <div class="andar-linha">
                <p class="andar-estado"></p>
                <button type="button" class="botao-secundario botao-andar-rumo" data-acao="andar-rumo" aria-label="Girar o mapa com você (frente para cima)">🧭</button>
            </div>
            <button type="button" class="botao-primario botao-largo" data-acao="andar-voltar-seguir" hidden>🎯 Voltar a seguir</button>
            <p class="andar-status andar-rumo-status" hidden></p>
        `;
        this._textoEstado = this.querySelector(".andar-estado");
        this._botaoVoltar = this.querySelector('[data-acao="andar-voltar-seguir"]');
        this._botaoRumo = this.querySelector('[data-acao="andar-rumo"]');
        this._textoRumo = this.querySelector(".andar-rumo-status");

        this._botaoVoltar.addEventListener("click", () => {
            if (!this._estado) return;
            this._estado.seguindo = true;
            this._avaliar({ retomou: true });
        });
        this._botaoRumo.addEventListener("click", () => this._alternarRumo());
    }

    disconnectedCallback() {
        this.parar();
    }

    get ativo() { return this._estado !== null; }
    get seguindo() { return this._estado?.seguindo ?? false; }

    set quadrados(lista) {
        this._quadrados = lista;
        if (this._estado?.posicao) this._avaliar({});
    }

    iniciar() {
        this.connectedCallback();
        if (this._estado) return;
        if (!("geolocation" in navigator)) {
            alert("Este navegador não tem geolocalização.");
            return;
        }
        const estado = { watchId: null, seguindo: true, primeiroSinal: true, posicao: null, rumo: null, proximos: [], maisProximo: null, distanciaM: Infinity };
        this._estado = estado;
        this.hidden = false;
        this._atualizarTexto();

        estado.watchId = navigator.geolocation.watchPosition(
            posicao => this._aoPosicao(posicao),
            erro => {
                this._pararGps();
                this._textoEstado.textContent = erro.code === erro.PERMISSION_DENIED
                    ? "Permissão de localização negada. Libere o acesso à localização nas configurações do navegador."
                    : "Não foi possível obter a posição. Tente de novo em campo aberto.";
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
    }

    parar() {
        if (!this._estado) return;
        this._pararGps();
        this._pararRumo();
        this._estado = null;
        this.hidden = true;
    }

    assumirControle() {
        if (this._estado?.seguindo) {
            this._estado.seguindo = false;
            this._atualizarTexto();
        }
    }

    // ---- GPS ----

    _pararGps() {
        if (this._estado?.watchId != null) {
            navigator.geolocation.clearWatch(this._estado.watchId);
            this._estado.watchId = null;
        }
    }

    _aoPosicao(posicao) {
        const estado = this._estado;
        if (!estado) return;
        estado.posicao = { lat: posicao.coords.latitude, lon: posicao.coords.longitude, precisao: posicao.coords.accuracy };

        // Sem bússola, o rumo vem do GPS — só vale andando; parado ele é aleatório.
        if (estado.rumo?.ativo && !estado.rumo.temBussola
            && posicao.coords.speed >= AndarGps.VELOCIDADE_MINIMA_GPS_MS && Number.isFinite(posicao.coords.heading)) {
            this._aplicarRumo(posicao.coords.heading);
        }
        this._avaliar({ novoSinal: true });
    }

    _avaliar({ novoSinal = false, retomou = false }) {
        const estado = this._estado;
        if (!estado?.posicao) return;

        const raio = raioDeBuscaM(estado.posicao.precisao);
        const { proximos, maisProximo } = encontrarMetrosProximos(estado.posicao, this._quadrados, raio);
        estado.proximos = proximos.map(m => m.quadrado);
        estado.maisProximo = maisProximo?.quadrado ?? null;
        estado.distanciaM = maisProximo?.distanciaM ?? Infinity;

        const primeiroSinal = novoSinal && estado.primeiroSinal;
        if (novoSinal) estado.primeiroSinal = false;

        this._atualizarTexto();
        this.dispatchEvent(new CustomEvent("posicao", {
            detail: {
                posicao: estado.posicao,
                proximos: estado.proximos,
                maisProximo: estado.maisProximo,
                distanciaM: estado.distanciaM,
                seguindo: estado.seguindo,
                atuando: estado.seguindo && estado.maisProximo !== null && estado.distanciaM <= AndarGps.RAIO_ATUAR_M,
                centralizar: (novoSinal || retomou) && estado.seguindo,
                primeiroSinal
            }
        }));
    }

    _atualizarTexto() {
        const estado = this._estado;
        if (!estado) return;
        this._botaoVoltar.hidden = estado.seguindo || !estado.posicao;
        this.classList.toggle("andar-faixa-livre", !estado.seguindo);

        if (!estado.posicao) {
            this._textoEstado.textContent = "Aguardando sinal do GPS…";
        } else if (!estado.seguindo) {
            this._textoEstado.textContent = "✋ Você está no controle. Toque em \"Voltar a seguir\" para o GPS guiar de novo.";
        } else if (estado.distanciaM > AndarGps.RAIO_ATUAR_M) {
            this._textoEstado.textContent = `📡 GPS ligado, mas a linha mais próxima está a ${estado.distanciaM.toFixed(0)} m.`;
        } else {
            const precisao = Number.isFinite(estado.posicao.precisao) ? `±${Math.round(estado.posicao.precisao)} m` : "precisão desconhecida";
            this._textoEstado.textContent = `📍 Seguindo o GPS (${precisao})` +
                (estado.posicao.precisao > 15 ? " — sinal fraco, confira olhando a linha." : ".");
        }
    }

    // ---- "Frente para cima": o mapa gira para o lado em que a pessoa olha ----

    _aplicarRumo(graus) {
        const rumo = this._estado?.rumo;
        if (!rumo?.ativo) return;
        rumo.suave = rumo.suave === null ? graus : suavizarAngulo(rumo.suave, graus, AndarGps.FATOR_SUAVIZACAO);

        // A bússola chega dezenas de vezes por segundo e treme: só gira quando muda de verdade.
        const agora = performance.now();
        if (agora - rumo.ultimaAplicacao < AndarGps.INTERVALO_MINIMO_MS) return;
        if (rumo.aplicado !== null && Math.abs(diferencaAngular(rumo.aplicado, rumo.suave)) < AndarGps.MUDANCA_MINIMA_GRAUS) return;
        rumo.aplicado = rumo.suave;
        rumo.ultimaAplicacao = agora;
        this.dispatchEvent(new CustomEvent("rumo", { detail: { graus: rumo.suave } }));
    }

    _pararRumo() {
        const rumo = this._estado?.rumo;
        if (!rumo) return;
        rumo.captador?.parar();
        this._estado.rumo = null;
        this.dispatchEvent(new CustomEvent("rumo-ativo", { detail: { ativo: false } }));
        this._botaoRumo.classList.remove("botao-andar-rumo-ligado");
        this._textoRumo.hidden = true;
    }

    async _alternarRumo() {
        if (!this._estado) return;
        if (this._estado.rumo) {
            this._pararRumo();
            return;
        }

        const rumo = { ativo: true, captador: new CaptadorRumo(), temBussola: false, suave: null, aplicado: null, ultimaAplicacao: 0 };
        this._estado.rumo = rumo;
        this.dispatchEvent(new CustomEvent("rumo-ativo", { detail: { ativo: true } }));
        this._botaoRumo.classList.add("botao-andar-rumo-ligado");
        this._textoRumo.hidden = false;
        this._textoRumo.textContent = "Procurando a bússola do aparelho…";

        rumo.captador.addEventListener(CaptadorRumo.EVENTO_RUMO, evento => this._aplicarRumo(evento.detail.graus));
        // Chamado direto do toque: o iOS só aceita pedir a permissão da bússola assim.
        rumo.temBussola = await rumo.captador.iniciar();

        if (this._estado?.rumo !== rumo) return; // a pessoa desligou enquanto esperava
        // Com bússola funcionando não há o que explicar (o botão aceso já diz); só avisa quando falta.
        this._textoRumo.hidden = rumo.temBussola;
        this._textoRumo.textContent = "Sem bússola (ou sem permissão): o mapa gira pela direção do GPS — ande reto alguns passos.";
    }
}

customElements.define("andar-gps", AndarGps);
