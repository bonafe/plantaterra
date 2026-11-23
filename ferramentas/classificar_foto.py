"""Decide se um recorte extraído de PDF é mesmo uma foto: descarta faixas de cabeçalho e desenhos técnicos.

`motivo_de_descarte(imagem)` → "faixa" | "desenho" | None. Regras (medidas nas amostras dos dois livros):
- faixa: proporção largura/altura > 2,5 (o cabeçalho de cada portfólio é uma tira escura com o nome científico por cima);
- desenho: ≥ 50% de pixels brancos e pouca cor (ciclos de vida, estruturas químicas, esquemas).
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
    return None
