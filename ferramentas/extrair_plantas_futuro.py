#!/usr/bin/env python3
"""Portfólios de "Plantas para o Futuro — Região Sul" (MMA/Embrapa, 2011) → JSON intermediário, uma entrada por espécie.

Uso: python3 extrair_plantas_futuro.py <blocos.json> <saida.json>
Blocos de `carvalho_texto.py` (ordem de leitura por coluna). Cada portfólio começa na página que tem "Família:" e "Espécie:";
o título (científico e popular) são os dois blocos de uma linha logo acima. Seções = rótulos "Xxx:" do livro, em ordem.
"""
import json, re, sys
from extrair_carvalho import juntar, vocabulario, sem_acento, MESES, num

# (nome da seção, início do rótulo no texto): o rótulo pode quebrar de linha ("…silviculturais para o / cultivo:"), então só o início casa.
ROTULOS = [("Família", "Família:"), ("Espécie", "Espécie:"), ("Sinonímia", "Sinonímia:"), ("Nomes populares", "Nomes? populares?:"),
           ("Características botânicas", "Características botânicas"), ("Distribuição geográfica", "Distribuição geográfica"), ("Hábitat", "Hábitat"),
           ("Uso econômico atual ou potencial", "Uso econômico"), ("Partes usadas", "Partes usadas"),
           ("Aspectos ecológicos, agronômicos e silviculturais para o cultivo", "Aspectos ecológicos"), ("Propagação", "Propagação"),
           ("Experiências relevantes com a espécie", "Experiências relevantes"), ("Situação de conservação da espécie", "Situação de conservação"),
           ("Referências bibliográficas", "Referências bibliográficas")]
RUIDO = re.compile(r"^(Plantas para o Futuro - Região Sul|Capítulo \d+ - .+|\d{1,4}|Figura \d+.*|\(Foto: .*)$")
NOTA_DE_AUTOR = re.compile(r"^(\d\s+)?(Eng\.|Engenheir|Biólog|Bióloga|Dr\.|Dra\.|MSc|Mestre|Professor|Prof\.|Pesquisador|E-mail|Email|Técnic|Graduand|Agrônom|Médic)")


def titulo(blocos, y_limite):
    acima = sorted((b for b in blocos if b["y"] < y_limite and len(b["linhas"]) == 1), key=lambda b: (b["c"], b["y"]))
    for k in range(len(acima) - 1):
        cien, pop = acima[k]["linhas"][0], acima[k + 1]["linhas"][0]
        if re.match(r"^[A-Z][a-z]+ [a-z]+", cien) and not cien.startswith(("Plantas", "Capítulo")) and acima[k + 1]["y"] - acima[k]["y"] < 60:
            return cien, pop
    return None


def categoria(pg, i):
    """Cabeçalho "Capítulo N - Medicinais" da própria página ou, se faltar, da vizinhança (até 6 páginas para trás/frente)."""
    for d in (0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6):
        if 0 <= i + d < len(pg):
            achou = next((re.sub(r"^Capítulo \d+ - ", "", l) for b in pg[i + d] for l in b["linhas"] if l.startswith("Capítulo ")), None)
            if achou:
                return achou
    return None


def secoes(linhas):
    """({seção: texto}, {seção: linhas cruas}) — os rótulos aparecem na ordem do livro; o que falta simplesmente não existe."""
    achados, proximo = [], 0
    for i, linha in enumerate(linhas):
        for k in range(proximo, len(ROTULOS)):
            if re.match(ROTULOS[k][1], linha):
                achados.append((i, ROTULOS[k][0]))
                proximo = k + 1
                break
    texto, cru = {}, {}
    for n, (i, nome) in enumerate(achados):
        fim = achados[n + 1][0] if n + 1 < len(achados) else len(linhas)
        cru[nome] = linhas[i:fim]
        corpo = juntar(linhas[i:fim])
        # Tira o rótulo (até os dois-pontos, no máximo 90 caracteres); "Referências bibliográficas" não tem dois-pontos.
        texto[nome] = re.sub(r"^[^:\n]{0,90}?:\s*", "", corpo, count=1) if nome != "Referências bibliográficas" else re.sub(r"^Referências bibliográficas\s*", "", corpo)
    return texto, cru


def meses(trecho):
    t = sem_acento(trecho)
    nomes = [sem_acento(m) for m in MESES]
    achados = set()
    for m in re.finditer(r"(" + "|".join(nomes) + r")\s*(?:-|–|a|ate)\s*(" + "|".join(nomes) + r")", t):
        a, b = nomes.index(m[1]), nomes.index(m[2])
        achados.update(range(a, b + 1) if a <= b else list(range(a, 12)) + list(range(0, b + 1)))
        t = t.replace(m[0], " ")
    for i, n in enumerate(nomes):
        if re.search(rf"\b{n}\b", t):
            achados.add(i)
    return sorted(m + 1 for m in achados)


def referencias(linhas):
    """Cada referência começa numa linha com SOBRENOME, em maiúsculas; as linhas seguintes continuam a mesma referência."""
    itens, atual = [], ""
    for linha in linhas:
        # Nova referência = linha que começa com SOBRENOME, e a anterior já terminou (ponto, parêntese ou número);
        # lista de autores quebrada em várias linhas ("…, Z.;" / "MATAKALA, P.;") continua a mesma referência.
        if re.match(r"^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ'’ -]{2,},\s", linha) and (not atual or re.search(r"[.)\d]\s*$", atual) and not re.search(r"\b[A-Z]\.\s*$", atual)):
            if atual:
                itens.append(atual)
            atual = linha
        else:
            atual = (atual + " " + linha).strip() if atual else atual
    if atual:
        itens.append(atual)
    return [" ".join(i.split()) for i in itens if len(i) > 25]


def extrair(pg, inicios):
    resultado = []
    for n, i in enumerate(inicios):
        fim = inicios[n + 1] - 1 if n + 1 < len(inicios) else len(pg)
        # Se o título do próximo portfólio está uma página antes, ele ainda é a "capa" da próxima: a página anterior à "Família:" não entra
        linhas = []
        for p in range(i, fim):  # (inclui as páginas de figuras e referências do portfólio)
            blocos = pg[p]
            for b in blocos:
                for l in b["linhas"]:
                    l = l.strip()
                    if l and not RUIDO.match(l) and not NOTA_DE_AUTOR.match(l):
                        linhas.append(l)
        fam = next(b for b in pg[i] if b["linhas"][0].startswith("Família:"))
        t = titulo(pg[i], fam["y"]) or titulo(pg[i - 1], 10**6)
        # Título implausível (rótulo do texto lido como nome, ou binômio no lugar do nome popular): descarta e usa o plano B.
        if t and (not re.match(r"^[A-Z][a-z]+ [a-z]+", t[0]) or t[0].startswith(("Partes", "Família", "Espécie", "Nomes")) or re.search(r"\(.*\)|[A-Z][a-z]+ [a-z]+ ", t[1])):
            t = None
        cientifico, popular = t if t else ("?", "?")
        linhas = [l for l in linhas if l not in (cientifico, popular)]
        s, cru = secoes(linhas)
        if cientifico == "?":  # sem bloco de título: o binômio vem da linha "Espécie:"; o popular, do primeiro nome popular
            m = re.match(r"([A-Z][a-z]+ [a-z]+)", s.get("Espécie", ""))
            cientifico = m[1] if m else "?"
            primeiro = re.split(r",\s*", s.get("Nomes populares", ""))[0].strip(" .")
            popular = primeiro[:40].capitalize() if primeiro else "?"
        reg = {"pagina_pdf": i + 1, "categoria": categoria(pg, i), "nome_cientifico_titulo": cientifico, "nome_popular": popular, "secoes": s}
        if s.get("Família"):
            reg["familia"] = s["Família"].strip(". ")
        if s.get("Espécie"):
            reg["especie_linha"] = s["Espécie"]
        if s.get("Sinonímia"):
            reg["sinonimia_texto"] = s["Sinonímia"]
        if s.get("Nomes populares"):
            texto = s["Nomes populares"]
            exterior = re.search(r"No exterior:\s*(.+)$", texto)
            principal = re.sub(r"\s*No exterior:.*$", "", texto, flags=re.S)
            principal = re.split(r"\.\s+[A-Z]", principal)[0]  # só a lista de nomes; frases depois do ponto ficam no texto da seção
            reg["nomes_populares"] = [re.sub(r"\s*\([^)]*\)", "", n).strip(" .") for n in re.split(r",\s*| ou ", principal) if n.strip(" .") and len(n) < 50]
            if exterior:
                reg["nomes_exterior_texto"] = exterior[1].strip()
        asp = s.get("Aspectos ecológicos, agronômicos e silviculturais para o cultivo", "")
        m = re.search(r"[Ff]lorescem?[^.]*\.", asp)
        if m and meses(m[0]):
            reg["floracao_meses"], reg["floracao_texto"] = meses(m[0]), m[0].strip()
        m = re.search(r"(?:frutos?|frutificação)[^.]*?(?:amadurec|matura|frutific)[^.]*\.", asp, re.I)
        if m and meses(m[0]):
            reg["frutificacao_meses"], reg["frutificacao_texto"] = meses(m[0]), m[0].strip()
        if s.get("Partes usadas"):
            reg["partes_usadas"] = s["Partes usadas"]
        m = re.search(r"(?:até|cerca de|aproximadamente)\s+(\d+(?:,\d+)?)\s*m\s+de\s+altura", s.get("Características botânicas", ""))
        if m:
            reg["altura_maxima_m"] = num(m[1])
        m = re.search(r"emergência[^.]*?(\d+)\s*(?:a|-|–)\s*(\d+)\s*dias", s.get("Propagação", ""))
        if m:
            reg["emergencia_dias"] = (num(m[1]), num(m[2]))
        if s.get("Referências bibliográficas"):
            reg["referencias"] = referencias(cru["Referências bibliográficas"][1:])
        resultado.append(reg)
    return resultado


def main(blocos_json, saida):
    pg = json.load(open(blocos_json, encoding="utf-8"))
    vocabulario([pg])
    inicios = [i for i, p in enumerate(pg)
               if any(l.startswith("Família:") for b in p for l in b["linhas"]) and any(l.startswith("Espécie:") for b in p for l in b["linhas"])]
    todos = extrair(pg, inicios)
    json.dump(todos, open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(todos), "portfólios;", sum(1 for t in todos if t["nome_cientifico_titulo"] == "?"), "sem título")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
