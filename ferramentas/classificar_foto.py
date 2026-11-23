"""Decide se um recorte extraído de PDF é mesmo uma foto: descarta faixas de cabeçalho e desenhos técnicos.

`motivo_de_descarte(imagem)` → "faixa" | "desenho" | None. Regras (medidas nas amostras dos dois livros):
- faixa: proporção largura/altura > 2,5 (o cabeçalho de cada portfólio é uma tira escura com o nome científico por cima);
- desenho: ≥ 50% de pixels brancos e pouca cor (ciclos de vida, estruturas químicas, esquemas);
- fragmento: pedaço de página recortado por engano — há uma barra preta lisa na base (entre ~8% e 45% da altura) com borda nítida — acima dela não é preto.
"""
from PIL import Image


def motivo_de_descarte(imagem):
    if imagem.width / max(imagem.height, 1) > 2.5:
        return "faixa"
    pequena = imagem.convert("RGB")
    pequena.thumbnail((120, 120))
    pixels = list(pequena.getdata())
    brancos = sum(1 for r, g, b in pixels if min(r, g, b) > 235)
    saturacoes = [(max(p) - min(p)) / max(p) for p in pixels if max(p) > 0 and min(p) < 235]
    media = sum(saturacoes) / len(saturacoes) if saturacoes else 0
    if brancos / len(pixels) >= 0.5 and media < 0.12:
        return "desenho"
    largura, altura = pequena.size
    if altura >= 12:
        def preto_na_linha(y):
            return sum(1 for x in range(largura) if max(pequena.getpixel((x, y))) < 14) / largura
        # Barra preta lisa na base: sobe enquanto a linha for toda preta e mede a altura dela.
        barra = 0
        while barra < altura and preto_na_linha(altura - 1 - barra) >= 0.97:
            barra += 1
        # Com borda nítida: logo acima dela NÃO é preto (num retrato com fundo preto, o preto continuaria).
        if altura // 12 <= barra <= altura * 0.45 and altura - barra - 3 >= 0 and preto_na_linha(altura - barra - 3) < 0.15:
            return "fragmento"
    return None
