#!/usr/bin/env python3
"""Fotos das fichas de "Espécies Arbóreas Brasileiras" (Carvalho, Embrapa).

Uso: python3 carvalho_fotos.py <pasta_volumes> <especies.json> <pasta_saida>
Cada ficha tem uma "prancha" de fotos: uma página com as fotos (árvore, casca, flores, folhas, frutos, sementes, mudas)
recortadas sobre fundo branco e as legendas ("Flores / Foto: Fulano") como texto. Renderiza a página (mutool), apaga as
legendas, separa as fotos por componentes conexos (dilatação + rotulagem em grade reduzida) e liga cada foto à legenda
mais próxima. Grava um JPEG por foto e `fotos.json` {"<volume>:<pagina_pdf>": [{legenda, credito, arquivo, w, h}]}.
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw
from classificar_foto import motivo_de_descarte

PPI = 75
REDUCAO = 6          # a rotulagem roda numa grade 6x menor
LADO_MAXIMO = 360
AREA_MINIMA = 0.012  # fração da página; abaixo disso é sujeira


def renderizar(pdf, pagina, destino):
    subprocess.run(["mutool", "draw", "-r", str(PPI), "-o", destino, pdf, str(pagina)], capture_output=True, check=True)


def legendas(pdf, pagina):
    """[(x0,y0,x1,y1 em pontos, legenda, crédito)] dos blocos de texto da página (menos o número da página)."""
    saida = subprocess.run(["mutool", "draw", "-F", "stext.json", "-o", "-", pdf, str(pagina)], capture_output=True, text=True).stdout
    blocos = json.loads(saida)["pages"][0]["blocks"]
    resultado = []
    for b in blocos:
        linhas = [l["text"].strip() for l in b.get("lines", []) if l["text"].strip()]
        if not linhas or re.fullmatch(r"\d{1,4}", linhas[0]):
            continue
        box = b["bbox"]
        legenda = linhas[0]
        credito = next((re.sub(r"^Fotos?:\s*", "", l) for l in linhas[1:] if l.startswith("Foto")), None)
        if linhas[0].startswith("Foto"):  # crédito sem legenda
            credito, legenda = re.sub(r"^Fotos?:\s*", "", linhas[0]), None
        resultado.append((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"], legenda, credito))
    return resultado


def componentes(mascara):
    """Rotulagem 4-conexa numa grade (lista de listas de bool) → lista de (x0,y0,x1,y1,area)."""
    h, w = len(mascara), len(mascara[0])
    visto = [[False] * w for _ in range(h)]
    saida = []
    for y in range(h):
        for x in range(w):
            if mascara[y][x] and not visto[y][x]:
                pilha, x0, y0, x1, y1, area = [(x, y)], x, y, x, y, 0
                visto[y][x] = True
                while pilha:
                    cx, cy = pilha.pop()
                    area += 1
                    x0, y0, x1, y1 = min(x0, cx), min(y0, cy), max(x1, cx), max(y1, cy)
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h and mascara[ny][nx] and not visto[ny][nx]:
                            visto[ny][nx] = True
                            pilha.append((nx, ny))
                saida.append((x0, y0, x1 + 1, y1 + 1, area))
    return saida


def distancia(a, b):
    dx = max(a[0] - b[2], b[0] - a[2], 0)
    dy = max(a[1] - b[3], b[1] - a[3], 0)
    return (dx * dx + dy * dy) ** 0.5


def fotos_da_pagina(pdf, pagina, pasta, prefixo):
    png = os.path.join(tempfile.gettempdir(), f"carv_{os.getpid()}.png")
    renderizar(pdf, pagina, png)
    imagem = Image.open(png).convert("RGB")
    escala = PPI / 72
    caps = legendas(pdf, pagina)
    # Mascara de "tem foto": não-branco, sem o texto das legendas.
    cinza = imagem.convert("L")
    nao_branco = cinza.point(lambda v: 255 if v < 238 else 0)
    desenho = ImageDraw.Draw(nao_branco)
    for x0, y0, x1, y1, *_ in caps:
        desenho.rectangle([x0 * escala - 2, y0 * escala - 2, x1 * escala + 2, y1 * escala + 2], fill=0)
    pequena = nao_branco.resize((imagem.width // REDUCAO, imagem.height // REDUCAO), Image.BOX).point(lambda v: 255 if v > 20 else 0)
    px = pequena.load()
    mascara = [[px[x, y] > 0 for x in range(pequena.width)] for y in range(pequena.height)]
    area_minima = AREA_MINIMA * pequena.width * pequena.height
    comps = [c for c in componentes(mascara) if c[4] >= area_minima]
    caixas = [(c[0] * REDUCAO, c[1] * REDUCAO, min(c[2] * REDUCAO, imagem.width), min(c[3] * REDUCAO, imagem.height)) for c in comps]
    legendas_px = [(x0 * escala, y0 * escala, x1 * escala, y1 * escala, leg, cred) for x0, y0, x1, y1, leg, cred in caps]

    # Cada legenda vai para a foto mais próxima. Fotos sobrepostas na prancha (ex.: o ramo florido por cima da foto da árvore)
    # formam um componente só, que fica com várias legendas — vira uma foto composta, legendada com todas.
    donas = {}
    for j, leg in enumerate(legendas_px):
        if caixas:
            i = min(range(len(caixas)), key=lambda k: distancia(caixas[k], leg[:4]))
            if distancia(caixas[i], leg[:4]) < 140:
                donas.setdefault(i, []).append(leg)
    resultado = []
    for i, caixa in enumerate(caixas):
        recorte = imagem.crop(caixa)
        recorte.thumbnail((LADO_MAXIMO, LADO_MAXIMO))
        legs = sorted(donas.get(i, []), key=lambda l: l[1])
        legenda = " · ".join(dict.fromkeys(l[4] for l in legs if l[4])) or None
        credito = ", ".join(dict.fromkeys(l[5] for l in legs if l[5])) or None
        nome = f"{prefixo}_{len(resultado) + 1}.jpg"
        recorte.save(os.path.join(pasta, nome), "JPEG", quality=72, optimize=True)
        # Várias legendas na mesma foto = fotos sobrepostas na prancha (colagem, com legendas escritas dentro): não é uma foto.
        motivo = "composta" if len(legs) >= 2 else motivo_de_descarte(recorte)
        resultado.append({"legenda": legenda, "credito": credito, "arquivo": nome, "w": recorte.width, "h": recorte.height,
                          "y": caixa[1], "x": caixa[0], **({"descartada": motivo} if motivo else {})})
    os.remove(png)
    return resultado


def main(pasta_volumes, especies_json, saida):
    os.makedirs(saida, exist_ok=True)
    especies = json.load(open(especies_json, encoding="utf-8"))
    resultado = {}
    for k, e in enumerate(especies):
        pdf = os.path.join(pasta_volumes, f"vol{e['volume']}.pdf")
        for pagina in e["paginas_foto_pdf"][:1]:
            chave = f"{e['volume']}:{e['pagina_pdf']}"
            resultado[chave] = fotos_da_pagina(pdf, pagina, saida, f"v{e['volume']}_p{e['pagina_pdf']}")
        if k % 40 == 0:
            print(k, "/", len(especies), flush=True)
    json.dump(resultado, open(os.path.join(saida, "fotos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(sum(len(v) for v in resultado.values()), "fotos em", len(resultado), "pranchas")


if __name__ == "__main__":
    main(*sys.argv[1:4])
