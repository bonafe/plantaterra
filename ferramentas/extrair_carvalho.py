#!/usr/bin/env python3
"""Fichas de "Espécies Arbóreas Brasileiras" (Carvalho, Embrapa) → JSON intermediário, uma entrada por espécie.

Uso: python3 extrair_carvalho.py <pasta_blocos> <saida.json>
Lê os `carvalho_volN_blocos.json` (ferramentas/carvalho_texto.py), separa as espécies (página que tem o título
"Taxonomia e Nomenclatura"), as seções (títulos fixos do livro, na ordem) e extrai os campos estruturados por regra.
Só vira campo o que o texto afirma; o texto de cada seção é guardado inteiro (uso local — não vai para o git).
"""
import json, re, sys, os, unicodedata

SECOES = ["Taxonomia e Nomenclatura", "Descrição", "Biologia Reprodutiva", "Ocorrência Natural", "Aspectos Ecológicos", "Clima", "Solos",
          "Sementes", "Produção de Mudas", "Características Silviculturais", "Crescimento e Produção", "Características da Madeira",
          "Produtos e Utilizações", "Espécies Afins"]
ALIAS = {"Descrição Botânica": "Descrição", "Tecnologia de Sementes": "Sementes"}
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def sem_acento(t):
    return unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode().lower()


def texto_da_pagina(blocos):
    linhas = []
    for b in blocos:
        linhas.extend(b["linhas"])
    return [l.strip() for l in linhas if l.strip() and not re.fullmatch(r"\d{1,4}", l.strip())]


def par_de_titulo(blocos, antes_de_y=10**6):
    """(popular, científico, extra) se a página tem os blocos de título: um nome popular e, logo abaixo, o científico."""
    acima = sorted((b for b in blocos if b["y"] < antes_de_y and len(b["linhas"]) == 1 and not re.match(r"\d", b["linhas"][0])), key=lambda b: b["y"])
    for k in range(len(acima) - 1):
        pop, cien = acima[k], acima[k + 1]
        if cien["y"] - pop["y"] <= 50 and re.match(r"^[A-Z][a-zçã]+ [a-z]", cien["linhas"][0]) and len(pop["linhas"][0]) < 45:
            extra = acima[k + 2]["linhas"][0] if k + 2 < len(acima) and acima[k + 2]["y"] - cien["y"] <= 50 and re.match(r"^(var\.|subesp|subsp|ssp)", acima[k + 2]["linhas"][0]) else None
            return pop["linhas"][0], cien["linhas"][0] + (" " + extra if extra else "")
    return None


def sumario(volume):
    """{científico: popular} do sumário do volume ('Caúna (Ilex theezans)')."""
    mapa = {}
    for blocos in volume[:40]:
        for b in blocos:
            for linha in b["linhas"]:
                m = re.match(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^()]{2,45}) \(([A-Z][a-z]+ [a-z][^)]*)\)$", linha.strip())
                if m:
                    mapa[m[2].strip()] = m[1].strip()
    return mapa


def capitulos(volume):
    """Fichas do volume: {pagina (a do "Taxonomia…"), popular, cientifico, paginas_foto, paginas (texto)}."""
    toc = sumario(volume)
    achados = []
    for i, blocos in enumerate(volume):
        alvo = next((b for b in blocos if b["linhas"][0] == "Taxonomia e Nomenclatura"), None)
        # A ficha de verdade traz "Família:" na mesma página (a página de introdução do livro, não).
        if not alvo or not any(l.startswith("Família:") for b in blocos for l in b["linhas"]):
            continue
        titulo, inicio = par_de_titulo(blocos, alvo["y"]), i
        for volta in range(1, 4):  # o título pode estar numa página antes (título → fotos → taxonomia)
            if titulo:
                break
            candidata = par_de_titulo(volume[i - volta])
            if candidata and not any(b["linhas"][0] == "Taxonomia e Nomenclatura" for b in volume[i - volta]):
                titulo, inicio = candidata, i - volta
        if not titulo:  # sem bloco de título: o sumário dá o popular, a linha "Espécie:" o científico
            especie = next((l for b in blocos for l in b["linhas"] if l.startswith(("Espécie:", "Binômio específico:"))), "")
            m = re.match(r"(?:Espécie|Binômio específico):\s*([A-Z][a-z]+ [a-z]+)", especie)
            cien = m[1] if m else None
            popular = next((p for c, p in toc.items() if cien and c.startswith(cien)), None)
            titulo = (popular or "?", cien or "?")
            inicio = i - 1
        achados.append({"pagina": i, "popular": titulo[0], "cientifico": titulo[1], "inicio": inicio})
    for cap in achados:
        # Título e taxonomia na mesma página: as fotos estão na página anterior.
        if cap["inicio"] == cap["pagina"]:
            cap["inicio"] = cap["pagina"] - 1
    for k, cap in enumerate(achados):
        fim = achados[k + 1]["inicio"] if k + 1 < len(achados) else len(volume)
        cap["paginas"] = list(range(cap["pagina"], fim))
        cap["paginas_foto"] = list(range(cap["inicio"], cap["pagina"]))
    return achados


def secoes_do_texto(linhas):
    """Divide as linhas nos títulos de seção, em ordem; título ausente simplesmente não aparece."""
    achados = []  # (indice_linha, nome)
    proxima = 0
    for idx, linha in enumerate(linhas):
        nome = ALIAS.get(linha, linha)
        if nome in SECOES and SECOES.index(nome) >= proxima and (not achados or achados[-1][1] != nome):
            achados.append((idx, nome))
            proxima = SECOES.index(nome) + (0 if nome == "Sementes" else 1)
    saida = {}
    for k, (idx, nome) in enumerate(achados):
        fim = achados[k + 1][0] if k + 1 < len(achados) else len(linhas)
        corpo = linhas[idx + 1:fim]
        if nome == "Biologia Reprodutiva" and corpo and corpo[0] == "e Fenologia":
            corpo = corpo[1:]
        saida[nome] = (saida.get(nome, "") + "\n" + juntar(corpo)).strip()
    return saida


VOCABULARIO = {}


def vocabulario(volumes):
    """Palavras do livro (sem hífen) com a contagem: decide se um hífen de fim de linha é de quebra ou de palavra composta."""
    for volume in volumes:
        for blocos in volume:
            for b in blocos:
                for linha in b["linhas"]:
                    for w in re.findall(r"[a-záéíóúâêôãõçà]{3,}", linha.lower()):
                        VOCABULARIO[w] = VOCABULARIO.get(w, 0) + 1


def emendar(texto, linha):
    """Une `texto` (que termina em hífen) à próxima linha: tira o hífen se a palavra inteira existe no livro (quebra),
    mantém se não (composto: "guatambu-" + "de-leite")."""
    esquerda = re.search(r"([A-Za-záéíóúâêôãõçàÁÉÍÓÚ]+)-$", texto)
    direita = re.match(r"-?([a-záéíóúâêôãõçà]+)", linha)
    if esquerda and direita and VOCABULARIO.get((esquerda[1] + direita[1]).lower(), 0) >= 3:
        return texto[:-1] + linha.lstrip("-")
    return texto + linha.lstrip("-")


def juntar(linhas):
    """Junta as linhas em parágrafos: quebra de linha vira espaço (ou nada após hífen), rótulo "Xxx:" abre parágrafo."""
    texto = ""
    for linha in linhas:
        if not texto:
            texto = linha
        elif texto.endswith("-") and not texto.endswith(" -") and linha.lstrip("-")[:1].islower():
            texto = emendar(texto, linha)
        elif re.match(r"^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][^:.]{2,50}:\s", linha) or linha.startswith("•"):
            texto += "\n" + linha
        else:
            texto += " " + linha
    return re.sub(r"[ \t]+", " ", texto).strip()


def numero(t):
    return float(t.replace(".", "").replace(",", ".")) if re.search(r",\d", t) is None or "." not in t else float(t.replace(".", "").replace(",", "."))


def num(t):
    t = t.strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", t):
        return float(t.replace(".", ""))
    return float(t.replace(",", "."))


def faixa(texto, unidade_regex):
    """'9 a 20 m de altura' → (9, 20); '12 m' → (12, 12)."""
    m = re.search(rf"(\d+(?:[.,]\d+)?)\s*(?:a|à|-|–)\s*(\d+(?:[.,]\d+)?)\s*{unidade_regex}", texto)
    if m:
        return num(m[1]), num(m[2])
    m = re.search(rf"(\d+(?:[.,]\d+)?)\s*{unidade_regex}", texto)
    return (num(m[1]), num(m[1])) if m else None


def meses_do_trecho(trecho):
    """Meses citados em 'de outubro a novembro … e de novembro a fevereiro' (intervalos viram todos os meses do intervalo)."""
    t = sem_acento(trecho)
    nomes = [sem_acento(m) for m in MESES]
    achados = set()
    for m in re.finditer(r"(?:de|desde)\s+(" + "|".join(nomes) + r")\s+(?:a|ate)\s+(" + "|".join(nomes) + r")", t):
        a, b = nomes.index(m[1]), nomes.index(m[2])
        achados.update(range(a, b + 1) if a <= b else list(range(a, 12)) + list(range(0, b + 1)))
        t = t.replace(m[0], " ")
    for i, n in enumerate(nomes):
        if re.search(rf"\b{n}\b", t):
            achados.add(i)
    return sorted(m + 1 for m in achados)


def rotulos(texto):
    """'Rótulo: valor' (parágrafos) → dict; o rótulo é o que vem antes dos dois-pontos no começo do parágrafo."""
    saida = {}
    for par in texto.split("\n"):
        m = re.match(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^:]{2,60}):\s*(.*)$", par)
        if m:
            saida.setdefault(m[1].strip(), m[2].strip())
    return saida


def nomes_vulgares(texto):
    """Só os nomes (sem as regiões onde são usados). Nome = uma palavra minúscula (com hífens); região = capitalizada ou com
    preposição ("na Bahia", "no Estado de São Paulo"), então cai fora."""
    nomes = []
    for pedaco in re.split(r"[;,]|\s+e\s+", texto.rstrip(".")):
        p = pedaco.strip()
        if re.fullmatch(r"[a-zà-úç][a-zà-úç0-9'’\-]*", p) and p not in ("na", "no", "em", "nos", "nas", "do", "da", "de", "e"):
            nomes.append(p)
    return list(dict.fromkeys(nomes))


def extrair(cap, volume, vol):
    linhas = []
    for n, i in enumerate(cap["paginas"]):
        parte = texto_da_pagina(volume[i])
        if n == 0:  # o título (popular / científico) fica solto no meio da coluna: sai do texto corrido
            parte = [l for l in parte if l not in (cap["popular"], cap["cientifico"].split(" subesp")[0], cap["cientifico"])]
        linhas += parte
    secoes = secoes_do_texto(linhas)
    reg = {"volume": vol, "pagina_pdf": cap["pagina"] + 1, "paginas_foto_pdf": [p + 1 for p in cap["paginas_foto"]], "nome_popular": cap["popular"], "nome_cientifico_titulo": cap["cientifico"], "secoes": secoes}

    tax = secoes.get("Taxonomia e Nomenclatura", "")
    hierarquia = {}
    for rotulo in ("Divisão", "Classe", "Clado", "Ordem", "Família", "Subfamília", "Tribo", "Gênero", "Publicação", "Primeira publicação"):
        m = re.search(rf"^{rotulo}:\s*(.+)$", tax, re.M)
        if m:
            hierarquia[sem_acento(rotulo).replace(" ", "_")] = m[1].strip()
    reg["hierarquia"] = hierarquia
    if hierarquia.get("familia"):
        reg["familia"] = re.sub(r"\s*\(.*$", "", hierarquia["familia"]).strip()
    m = re.search(r"(?:Espécie|Binômio específico):\s*(.+?)(?=\nPublicação|\nPrimeira publicação|\nSinonímia|\nNomes vulgares|$)", tax, re.S)
    if m:
        reg["especie_linha"] = " ".join(m[1].split())
    m = re.search(r"Sinonímia botânica:\s*(.+?)(?=\nNota:|Nomes vulgares|\nEtimologia|$)", tax, re.S)
    if m:
        reg["sinonimia_texto"] = " ".join(m[1].split())
    m = re.search(r"Nomes vulgares[^:]{0,45}?:\s*(.+?)(?=\nNomes vulgares no exterior|Nomes vulgares no exterior|\nEtimologia|\nNota:|$)", tax, re.S)
    if m:
        reg["nomes_vulgares_texto"] = " ".join(m[1].split())
        reg["nomes_vulgares"] = nomes_vulgares(reg["nomes_vulgares_texto"])
    m = re.search(r"Nomes vulgares no exterior:\s*(.+?)(?=\nEtimologia|$)", tax, re.S)
    if m:
        reg["nomes_exterior_texto"] = " ".join(m[1].split())
    m = re.search(r"Etimologia:\s*(.+)$", tax, re.S)
    if m:
        reg["etimologia"] = " ".join(m[1].split())

    desc = secoes.get("Descrição", "")
    r = rotulos(desc)
    chave_forma = next((k for k in r if k.startswith("Forma")), None)
    if chave_forma:
        fb = r[chave_forma]
        reg["forma_biologica"] = fb
        f = faixa(re.split(r"podendo|atingindo|chegando", fb)[0], r"m\s+de\s+altura")
        if f:
            reg["altura_m"] = f
        m = re.search(r"podendo atingir (?:até )?(\d+(?:,\d+)?)\s*m", fb)
        if m:
            reg["altura_maxima_m"] = num(m[1])
        d = faixa(fb, r"cm\s+de\s+DAP")
        if d:
            reg["dap_cm"] = d
    bio = secoes.get("Biologia Reprodutiva", "")
    rb = rotulos(bio)
    for chave, rotulo in (("floracao", "Floração"), ("frutificacao", "Frutificação")):
        if rb.get(rotulo):
            reg[chave + "_texto"] = rb[rotulo]
            primeiro = re.split(r"\.\s", rb[rotulo])[0]
            meses = meses_do_trecho(primeiro)
            if meses:
                reg[chave + "_meses"] = meses
    for chave, rotulo in (("sistema_sexual", "Sistema sexual"), ("vetor_polinizacao", "Vetor de polinização"), ("dispersao", "Dispersão de frutos e sementes")):
        if rb.get(rotulo):
            reg[chave] = rb[rotulo]
    eco = rotulos(secoes.get("Aspectos Ecológicos", ""))
    if eco.get("Grupo sucessional"):
        reg["grupo_sucessional"] = eco["Grupo sucessional"]
    sem = secoes.get("Sementes", "")
    m = re.search(r"Número de sementes por quilo:\s*([^\n]+)", sem)
    if m:
        reg["sementes_por_kg_texto"] = m[1].strip()
        n = re.search(r"(\d{1,3}(?:\.\d{3})+|\d+)", m[1])
        if n:
            reg["sementes_por_kg"] = num(n[1])
    mud = secoes.get("Produção de Mudas", "")
    m = re.search(r"emergência[^.]*?(\d+)\s*(?:a|-|–)\s*(\d+)\s*dias", mud)
    if m:
        reg["emergencia_dias"] = (num(m[1]), num(m[2]))
    m = re.search(r"taxa de germinação[^.]*?(\d+(?:,\d+)?)\s*%", mud) or re.search(r"germinação[^.]*?(?:de|até)\s*(\d+(?:,\d+)?)\s*%", mud)
    if m:
        reg["germinacao_percentual_citado"] = num(m[1])
    mad = secoes.get("Características da Madeira", "")
    for chave, rotulo in (("densidade_aparente_g_cm3", "Massa específica aparente"), ("densidade_basica_g_cm3", "Massa específica básica")):
        m = re.search(rf"{rotulo}[^\n]*?(\d,\d+)(?:\s*a\s*(\d,\d+))?\s*g\s*[./]\s*cm", mad)
        if m:
            reg[chave] = (num(m[1]), num(m[2] or m[1]))
    return reg


def main(pasta, saida):
    todos = []
    volumes = [json.load(open(os.path.join(pasta, f"carvalho_vol{vol}_blocos.json"), encoding="utf-8")) for vol in range(1, 6)]
    vocabulario(volumes)
    for vol, volume in enumerate(volumes, 1):
        for cap in capitulos(volume):
            todos.append(extrair(cap, volume, vol))
    json.dump(todos, open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(len(todos), "espécies")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
