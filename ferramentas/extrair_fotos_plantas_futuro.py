#!/usr/bin/env python3
"""Fotos de "Plantas para o Futuro — Região Sul": cada figura é uma imagem própria do PDF.

Uso: python3 extrair_fotos_plantas_futuro.py <pdf> <blocos.json> <pf_sul_especies.json> <pasta_saida>
`mutool trace` dá a posição de cada imagem (fill_image); a página é renderizada a 100 ppi e a figura recortada. A legenda
("Figura 2 - Detalhes da flor de … (Foto: Alexandre Uhlmann)") é o bloco "Figura N" logo abaixo (ou acima) da imagem.
Grava um JPEG por foto e `fotos.json` {"<pagina_pdf do portfólio>": [{legenda, credito, arquivo, w, h}]}.
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image
from classificar_foto import motivo_de_descarte

PPI = 100
LADO_MAXIMO = 360


def imagens_da_pagina(pdf, pagina):
    saida = subprocess.run(["mutool", "trace", pdf, str(pagina)], capture_output=True, text=True).stdout
    caixas = []
    for m in re.finditer(r'<fill_image[^>]*transform="([^"]+)"', saida):
        a, b, c, d, e, f = map(float, m[1].split())
        if abs(a) >= 70 and abs(d) >= 55:  # ignora ícones/filetes
            caixas.append((min(e, e + a), min(f, f + d), max(e, e + a), max(f, f + d)))
    return caixas


def legendas(blocos):
    """[(x0, y0, texto, credito)] dos blocos que começam com 'Figura N' (a linha do crédito pode vir no mesmo bloco)."""
    achadas = []
    for b in blocos:
        primeira = b["linhas"][0]
        if re.match(r"^Figura\s+\d+", primeira):
            texto = " ".join(b["linhas"])
            credito = re.search(r"Foto[s]?:\s*([^)]+)\)?", texto)
            legenda = re.sub(r"\s*\(Foto[s]?:[^)]*\)\s*$", "", re.sub(r"^Figura\s+\d+\s*[-–]\s*", "", texto)).strip()
            achadas.append((b["x"], b["y"], legenda, credito[1].strip() if credito else None))
    return achadas


def main(pdf, blocos_json, especies_json, saida):
    os.makedirs(saida, exist_ok=True)
    pg = json.load(open(blocos_json, encoding="utf-8"))
    especies = json.load(open(especies_json, encoding="utf-8"))
    paginas = [e["pagina_pdf"] for e in especies]
    resultado = {}
    escala = PPI / 72
    for n, inicio in enumerate(paginas):
        fim = paginas[n + 1] - 1 if n + 1 < len(paginas) else min(inicio + 8, len(pg))
        fotos = []
        for pagina in range(inicio, fim + 1):
            # Página de abertura de capítulo (quase sem texto e sem "Figura N"): a imagem é a capa, não uma foto da espécie.
            texto = [l for b in pg[pagina - 1] for l in b["linhas"]]
            if len(texto) < 10 and not any(re.match(r"^Figura\s+\d+", l) for l in texto):
                continue
            caixas = imagens_da_pagina(pdf, pagina)
            if not caixas:
                continue
            png = os.path.join(tempfile.gettempdir(), f"pf_{os.getpid()}.png")
            subprocess.run(["mutool", "draw", "-r", str(PPI), "-o", png, pdf, str(pagina)], capture_output=True, check=True)
            pagina_img = Image.open(png).convert("RGB")
            caps = legendas(pg[pagina - 1])
            for x0, y0, x1, y1 in sorted(caixas, key=lambda c: (c[1], c[0])):
                # Legenda: a mais próxima verticalmente, abaixo da imagem (ou, se não houver, acima).
                abaixo = [c for c in caps if c[1] >= y1 - 8 and c[0] < x1]
                acima = [c for c in caps if c[1] < y0 and c[0] < x1]
                cap = min(abaixo, key=lambda c: c[1] - y1) if abaixo else (max(acima, key=lambda c: c[1]) if acima else None)
                if cap in caps:
                    caps = [c for c in caps if c is not cap]
                recorte = pagina_img.crop(tuple(int(v * escala) for v in (x0, y0, x1, y1)))
                recorte.thumbnail((LADO_MAXIMO, LADO_MAXIMO))
                nome = f"pf_p{inicio}_{len(fotos) + 1}.jpg"
                recorte.save(os.path.join(saida, nome), "JPEG", quality=72, optimize=True)
                motivo = motivo_de_descarte(recorte)
                fotos.append({"legenda": cap[2] if cap else None, "credito": cap[3] if cap else None, "arquivo": nome, "w": recorte.width, "h": recorte.height,
                              "pagina": pagina, **({"descartada": motivo} if motivo else {})})
            os.remove(png)
        resultado[str(inicio)] = fotos
    json.dump(resultado, open(os.path.join(saida, "fotos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(sum(len(v) for v in resultado.values()), "fotos em", sum(1 for v in resultado.values() if v), "portfólios")


if __name__ == "__main__":
    main(*sys.argv[1:5])
