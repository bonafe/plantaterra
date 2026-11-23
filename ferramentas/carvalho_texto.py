#!/usr/bin/env python3
"""Texto de "Espécies Arbóreas Brasileiras" (Carvalho, Embrapa) em ordem de leitura por coluna, página a página.

Uso: python3 carvalho_texto.py <pdf> <saida.json>
`pdftotext -bbox-layout` dá os blocos com coordenadas; as páginas têm duas colunas (blocos começando antes de ~36% da
largura = coluna esquerda), então lê-se a esquerda de cima para baixo e depois a direita. Saída: lista de páginas,
cada uma uma lista de blocos {c: coluna 0/1, y, x, texto}.
"""
import json, re, subprocess, sys
from html import unescape


def paginas(pdf):
    html = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    for pagina in re.split(r"<page ", html)[1:]:
        largura = float(re.search(r'width="([\d.]+)"', pagina).group(1))
        blocos = []
        for bloco in re.finditer(r'<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</block>', pagina, re.S):
            x, y, x2, y2, corpo = float(bloco[1]), float(bloco[2]), float(bloco[3]), float(bloco[4]), bloco[5]
            linhas = []
            for linha in re.finditer(r"<line [^>]*>(.*?)</line>", corpo, re.S):
                texto = ""
                anterior = None
                # Palavras coladas (letra capitular "E" + "spécie", kerning) têm intervalo ~0: não ganham espaço.
                for w in re.finditer(r'<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">(.*?)</word>', linha[1], re.S):
                    if anterior is not None and float(w[1]) - anterior > 0.9:
                        texto += " "
                    texto += unescape(w[3])
                    anterior = float(w[2])
                if texto:
                    linhas.append(texto)
            if linhas:
                blocos.append({"c": 0 if x / largura < 0.36 else 1, "y": round(y), "x": round(x), "larg": round((x2 - x) / largura, 2), "linhas": linhas})
        blocos.sort(key=lambda b: (b["c"], b["y"], b["x"]))
        yield blocos


if __name__ == "__main__":
    json.dump(list(paginas(sys.argv[1])), open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
