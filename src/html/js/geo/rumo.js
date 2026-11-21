/**
 * Matemática de rumo (direção da bússola, em graus no sentido horário a
 * partir do norte) usada pelo "frente para cima" do modo Andar (ver
 * docs/especificacao.md secao 14.9). Funções puras.
 */

/** Leva qualquer ângulo para [0, 360). */
export function normalizarGraus(graus) {
    return ((graus % 360) + 360) % 360;
}

/** Menor diferença assinada de `de` para `para`, em (-180, 180]. */
export function diferencaAngular(de, para) {
    const d = normalizarGraus(para - de);
    return d > 180 ? d - 360 : d;
}

/**
 * Média móvel exponencial de ângulos, pelo caminho mais curto (de 359° para
 * 1° anda 2°, não 358°). `fator` entre 0 (ignora a nova leitura) e 1 (usa só a nova).
 */
export function suavizarAngulo(atual, alvo, fator) {
    return normalizarGraus(atual + diferencaAngular(atual, alvo) * fator);
}

/**
 * Rumo da bússola a partir dos ângulos de orientação do aparelho
 * (DeviceOrientationEvent absoluto: alpha/beta/gamma em graus) — fórmula do
 * exemplo da especificação W3C. Responde para onde a pessoa está olhando com o
 * celular na mão, inclinado, e não só quando está deitado.
 * Retorna null se não houver alpha (sensor sem leitura absoluta).
 */
export function calcularRumoBussola(alpha, beta, gamma) {
    if (alpha === null || alpha === undefined || Number.isNaN(alpha)) return null;

    const rad = Math.PI / 180;
    const x = (beta ?? 0) * rad;
    const y = (gamma ?? 0) * rad;
    const z = alpha * rad;

    const cY = Math.cos(y);
    const cZ = Math.cos(z);
    const sX = Math.sin(x);
    const sY = Math.sin(y);
    const sZ = Math.sin(z);

    const vx = -cZ * sY - sZ * sX * cY;
    const vy = -sZ * sY + cZ * sX * cY;

    // Aparelho perfeitamente deitado: a fórmula degenera (0/0); o rumo é só o alpha.
    if (Math.abs(vx) < 1e-9 && Math.abs(vy) < 1e-9) {
        return normalizarGraus(360 - alpha);
    }

    let rumo = Math.atan(vx / vy);
    if (vy < 0) rumo += Math.PI;
    else if (vx < 0) rumo += 2 * Math.PI;
    return normalizarGraus(rumo / rad);
}
