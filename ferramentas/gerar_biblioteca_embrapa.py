#!/usr/bin/env python3
"""Fichas de Carvalho (Embrapa) → arquivo de biblioteca do PlantaTerra (esquema do catálogo botânico, com fotos em base64).

Uso: python3 gerar_biblioteca_embrapa.py <carvalho_especies.json> <pasta_fotos> <03_catalogo_nacional.jsonl.gz> <temp/super/01a_embrapa_com_fotos.json> [pf_sul_especies.json [pasta_fotos_pf]]
Cada ficha ganha o nome aceito/família/origem/estados do catálogo nacional (JBRJ) quando o nome científico do livro (Cronquist,
2003-2017) é encontrado lá — se for sinônimo, vale o aceito e o nome do livro vira sinônimo. O arquivo é de USO LOCAL
(texto e fotos são da Embrapa/autores): fica em temp/ (git ignora) e entra no app pelo "Importar" da biblioteca.
"""
import base64, datetime, gzip, json, os, re, sys

ANOS = {1: 2003, 2: 2006, 3: 2008, 4: 2010, 5: 2014}
NEGATIVO = re.compile(r"inadequad|não é (?:indicad|recomendad|apropriad|utilizad|adequad)|não se (?:presta|recomenda)|sem (?:valor|aptidão)", re.I)
FUNCOES = [("restauracao_ecologica", r"ambiental|restaura|recupera"), ("ornamental", r"paisag|arboriza|ornament"), ("madeira", r"madeira"),
           ("lenha_e_carvao", r"energia|lenha|carv"), ("melifera", r"ap[íi]col|mel"), ("alimento", r"aliment|fruto|comest"),
           ("forragem", r"forrag"), ("medicinal", r"medicin|fitoter")]


def catalogo_jbrj(caminho):
    por_nome, por_id = {}, {}
    with gzip.open(caminho, "rt", encoding="utf-8") as f:
        next(f)
        for linha in f:
            r = json.loads(linha)
            por_id[r["id"]] = r
            if r.get("k") in ("sp", "var", "ssp") and r["c"] not in por_nome or r.get("st") == "A":
                por_nome[r["c"]] = r
    return por_nome, por_id


def resolver(titulo, por_nome, por_id):
    """(registro aceito do JBRJ ou None, nome do livro se difere do aceito)."""
    for tentativa in (titulo, " ".join(titulo.split()[:2])):
        r = por_nome.get(tentativa)
        if r:
            aceito = por_id.get(r.get("ai"), r) if r.get("st") == "S" else r
            return aceito, (titulo if aceito["c"] != titulo else None)
    return None, None


def lista_sinonimos(texto):
    return [s.strip() for s in re.split(r";", texto or "") if s.strip() and len(s.strip()) < 120][:20]


def faixa(par):
    return {"min": par[0], "max": par[1], "unidade": "m"} if par else None


def usos_e_funcoes(texto):
    usos, funcoes = [], []
    for par in (texto or "").split("\n"):
        m = re.match(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^:]{2,70}):\s*(.*)$", par)
        if not m or NEGATIVO.search(m[2]):
            continue
        rotulo = m[1].strip().lower()
        usos.append(rotulo)
        funcoes += [f for f, rx in FUNCOES if re.search(rx, rotulo) and f not in funcoes]
    return usos, funcoes


def forma_de_vida(texto):
    t = (texto or "")[:120].lower()
    for rx, nome in ((r"palmeira|palmácea", "palmeira"), (r"árvore|arbóre", "árvore"), (r"arbust", "arbusto")):
        if re.search(rx, t):
            return nome
    return None


def data_url(caminho):
    return "data:image/jpeg;base64," + base64.b64encode(open(caminho, "rb").read()).decode()


def fotos_da_ficha(lista, pasta):
    # Ordem de leitura; a foto que traz a legenda "Árvore" abre a lista (é a que vira capa do card).
    lista = [f for f in lista if not f.get("descartada")]  # faixas, desenhos e colagens ficam de fora
    ordenadas = sorted(lista, key=lambda f: (round(f["y"] / 80), f["x"]))
    ordenadas.sort(key=lambda f: 0 if f.get("legenda") and "árvore" in f["legenda"].lower() else 1)
    return [{"src": data_url(os.path.join(pasta, f["arquivo"])), "legenda": f["legenda"], "credito": f["credito"]} for f in ordenadas]


def registro(e, fotos, por_nome, por_id):
    s = e["secoes"]
    aceito, nome_no_livro = resolver(e["nome_cientifico_titulo"], por_nome, por_id)
    cientifico = aceito["c"] if aceito else e["nome_cientifico_titulo"]
    sinonimos = lista_sinonimos(e.get("sinonimia_texto"))
    if nome_no_livro:
        sinonimos.insert(0, nome_no_livro)
    populares = [n for n in [e["nome_popular"]] + [n for n in e.get("nomes_vulgares", []) if n.lower() != e["nome_popular"].lower()] if n and n != "?"]
    usos, funcoes = usos_e_funcoes(s.get("Produtos e Utilizações"))
    textos_luz = " ".join([s.get("Características Silviculturais", ""), s.get("Aspectos Ecológicos", "")]).lower()
    luz = None
    if "heliófil" in textos_luz and "esciófil" not in textos_luz:
        luz = "pleno sol"
    elif "esciófil" in textos_luz and "heliófil" not in textos_luz:
        luz = "sombra"

    atributos = {"origem_no_brasil": aceito.get("o") if aceito else None, "forma_de_vida": forma_de_vida(e.get("forma_biologica")),
                 "exigencia_luminosa": luz, "funcoes_agroflorestais": funcoes, "usos": usos}
    if e.get("altura_m"):
        atributos["altura_m"] = {**faixa(e["altura_m"]), **({"observacao": f"podendo atingir até {e['altura_maxima_m']:g} m (segundo o livro)"} if e.get("altura_maxima_m") else {})}
    if e.get("dap_cm"):
        atributos["diametro_tronco_cm"] = {"min": e["dap_cm"][0], "max": e["dap_cm"][1]}
    dens = e.get("densidade_aparente_g_cm3") or e.get("densidade_basica_g_cm3")
    if dens:
        atributos["densidade_madeira_g_cm3"] = round(sum(dens) / 2, 3)
    if e.get("floracao_meses"):
        atributos["floracao_meses_brasil_livro"] = e["floracao_meses"]
    if e.get("frutificacao_meses"):
        atributos["frutificacao_meses_brasil_livro"] = e["frutificacao_meses"]
    if e.get("sementes_por_kg"):
        atributos["sementes_por_kg_aproximadamente"] = int(e["sementes_por_kg"])
    if e.get("emergencia_dias"):
        atributos["emergencia_dias"] = {"min": e["emergencia_dias"][0], "max": e["emergencia_dias"][1]}
    if e.get("grupo_sucessional"):
        atributos["grupo_sucessional"] = re.split(r"\sCaracterísticas sociológicas", e["grupo_sucessional"])[0]
    if e.get("sistema_sexual"):
        atributos["sistema_sexual"] = e["sistema_sexual"].rstrip(".")
    if e.get("dispersao"):
        atributos["dispersao"] = e["dispersao"].rstrip(".")
    atributos = {k: v for k, v in atributos.items() if v not in (None, [], {})}

    ocorrencia = s.get("Ocorrência Natural", "")
    if aceito and aceito.get("uf"):
        ocorrencia = (ocorrencia + "\n\n" if ocorrencia else "") + "Flora e Funga do Brasil (JBRJ): ocorre em " + ", ".join(aceito["uf"]) + "."
    descricao = {"caracteristicas_morfologicas": s.get("Descrição"), "ocorrencia": ocorrencia or None, "madeira": s.get("Características da Madeira"),
                 "utilidade": s.get("Produtos e Utilizações"), "informacoes_ecologicas": s.get("Aspectos Ecológicos"),
                 "fenologia": s.get("Biologia Reprodutiva"), "obtencao_de_sementes": s.get("Sementes"), "producao_de_mudas": s.get("Produção de Mudas"),
                 "clima": s.get("Clima"), "solos": s.get("Solos"), "caracteristicas_silviculturais": s.get("Características Silviculturais"),
                 "crescimento_e_producao": s.get("Crescimento e Produção"), "especies_afins": s.get("Espécies Afins"),
                 "etimologia": e.get("etimologia"), "nomes_vulgares_por_uf": e.get("nomes_vulgares_texto"), "nomes_no_exterior": e.get("nomes_exterior_texto")}
    descricao = {k: v for k, v in descricao.items() if v}

    vol = e["volume"]
    return {
        "id": "jbrj-" + aceito["id"] if aceito else f"embrapa-carvalho-v{vol}-{re.sub(r'[^a-z0-9]+', '-', e['nome_cientifico_titulo'].lower()).strip('-')}",
        "identificacao": {"nome_cientifico": cientifico, "autoria": (aceito or {}).get("a") or None, "nomes_populares": populares,
                          "familia": (aceito or {}).get("f") or e.get("familia"), "sinonimos_conforme_livro": sinonimos},
        "fonte_primaria": {"tipo": "livro", "titulo_da_obra": "Espécies Arbóreas Brasileiras (P. E. R. Carvalho, Embrapa)", "pagina": e["pagina_pdf"],
                           "nota": f"Volume {vol}, {ANOS[vol]}; página do arquivo PDF. Extração automática por regras — conferir no livro."},
        "descricao": descricao,
        "atributos": atributos,
        "fotos": fotos,
        "fontes_externas": [f"http://reflora.jbrj.gov.br/reflora/listaBrasil/FichaPublicaTaxonUC/FichaPublicaTaxonUC.do?id=FB{aceito['id']}"] if aceito else [],
        "observacoes_de_curadoria": "Fichas do livro de Carvalho (Embrapa) lidas automaticamente; taxonomia do livro (Cronquist/APG da época) reconciliada com o catálogo nacional quando possível."
                                    + (f" Nome no livro: {nome_no_livro}." if nome_no_livro else ""),
        "taxonomia_do_livro": {**e.get("hierarquia", {}), "especie": e.get("especie_linha")},
    }


CATEGORIA_FUNCAO = {"Medicinais": "medicinal", "Alimentícias": "alimento", "Madeireiras": "madeira", "Ornamentais": "ornamental",
                    "Aromáticas": "aromatica", "Fibrosas": "fibra"}


def registro_pf(e, por_nome, por_id):
    """Portfólio de "Plantas para o Futuro — Sul" → registro de biblioteca."""
    s = e["secoes"]
    aceito, nome_no_livro = resolver(e["nome_cientifico_titulo"], por_nome, por_id)
    cientifico = aceito["c"] if aceito else e["nome_cientifico_titulo"]
    sinonimos = lista_sinonimos(re.split(r"\nNome popular", s.get("Sinonímia", ""))[0].replace("\n", "; "))
    if nome_no_livro:
        sinonimos.insert(0, nome_no_livro)
    populares = [n for n in dict.fromkeys([e["nome_popular"]] + e.get("nomes_populares", [])) if n and n != "?"]
    categoria = e.get("categoria") or ""
    funcao = next((f for k, f in CATEGORIA_FUNCAO.items() if categoria.startswith(k)), "forragem" if categoria.startswith("Forrageiras") else None)
    partes = [p.strip() for p in re.split(r"[;,.]|\be\b", re.sub(r"\([^)]*\)", "", s.get("Partes usadas", ""))) if 2 < len(p.strip()) < 40]
    atributos = {"origem_no_brasil": aceito.get("o") if aceito else None, "funcoes_agroflorestais": [funcao] if funcao else [],
                 "forma_de_vida": forma_de_vida(s.get("Características botânicas", "")) or (", ".join(aceito.get("v", [])) if aceito and aceito.get("v") else None),
                 "partes_utilizadas": partes[:8], "categoria_plantas_para_o_futuro": categoria or None}
    if e.get("floracao_meses"):
        atributos["floracao_meses_brasil_livro"] = e["floracao_meses"]
    if e.get("frutificacao_meses"):
        atributos["frutificacao_meses_brasil_livro"] = e["frutificacao_meses"]
    if e.get("emergencia_dias"):
        atributos["emergencia_dias"] = {"min": e["emergencia_dias"][0], "max": e["emergencia_dias"][1]}
    if s.get("Situação de conservação da espécie"):
        atributos["advertencia_conservacao"] = s["Situação de conservação da espécie"][:580]
    atributos = {k: v for k, v in atributos.items() if v not in (None, [], {})}
    ocorrencia = s.get("Distribuição geográfica", "")
    if aceito and aceito.get("uf"):
        ocorrencia = (ocorrencia + "\n\n" if ocorrencia else "") + "Flora e Funga do Brasil (JBRJ): ocorre em " + ", ".join(aceito["uf"]) + "."
    descricao = {"caracteristicas_morfologicas": s.get("Características botânicas"), "ocorrencia": ocorrencia or None,
                 "informacoes_ecologicas": s.get("Hábitat"), "utilidade": s.get("Uso econômico atual ou potencial"),
                 "producao_de_mudas": s.get("Propagação"),
                 "aspectos_ecologicos_agronomicos_e_silviculturais": s.get("Aspectos ecológicos, agronômicos e silviculturais para o cultivo"),
                 "experiencias_relevantes": s.get("Experiências relevantes com a espécie"), "partes_usadas": s.get("Partes usadas")}
    descricao = {k: v for k, v in descricao.items() if v}
    return {
        "id": "jbrj-" + aceito["id"] if aceito else "embrapa-pf-sul-" + re.sub(r"[^a-z0-9]+", "-", e["nome_cientifico_titulo"].lower()).strip("-"),
        "identificacao": {"nome_cientifico": cientifico, "autoria": (aceito or {}).get("a") or None, "nomes_populares": populares,
                          "familia": (aceito or {}).get("f") or e.get("familia"), "sinonimos_conforme_livro": sinonimos},
        "fonte_primaria": {"tipo": "livro", "titulo_da_obra": "Plantas para o Futuro — Região Sul (MMA/Embrapa, 2011)", "pagina": e["pagina_pdf"],
                           "nota": "Portfólio da espécie; página do arquivo PDF. Extração automática por regras — conferir no livro."},
        "descricao": descricao, "atributos": atributos, "referencias": e.get("referencias", []), "fotos": [],
        "fontes_externas": [f"http://reflora.jbrj.gov.br/reflora/listaBrasil/FichaPublicaTaxonUC/FichaPublicaTaxonUC.do?id=FB{aceito['id']}"] if aceito else [],
        "observacoes_de_curadoria": "Portfólio de Plantas para o Futuro (Região Sul) lido automaticamente; taxonomia reconciliada com o catálogo nacional quando possível."
                                    + (f" Nome no livro: {nome_no_livro}." if nome_no_livro else ""),
        "taxonomia_do_livro": {"familia": e.get("familia"), "especie": e.get("especie_linha")},
    }


def fundir(principal, extra):
    """Mesma espécie nos dois livros: a ficha do `principal` fica e recebe o que o `extra` traz (sem sobrescrever)."""
    for chave, valor in extra["descricao"].items():
        principal["descricao"].setdefault(chave, valor)
        if principal["descricao"][chave] != valor and chave in principal["descricao"]:
            principal["descricao"][f"{chave}__plantas_para_o_futuro"] = valor
    for chave, valor in extra["atributos"].items():
        principal["atributos"].setdefault(chave, valor)
    ident, outra = principal["identificacao"], extra["identificacao"]
    ident["nomes_populares"] = list(dict.fromkeys(ident["nomes_populares"] + outra["nomes_populares"]))
    ident["sinonimos_conforme_livro"] = list(dict.fromkeys(ident["sinonimos_conforme_livro"] + outra["sinonimos_conforme_livro"]))
    principal["referencias"] = list(dict.fromkeys(principal.get("referencias", []) + extra.get("referencias", [])))
    principal["fotos"] += extra.get("fotos", [])
    principal["fonte_primaria"]["nota"] += " Também em: " + extra["fonte_primaria"]["titulo_da_obra"] + f", p. {extra['fonte_primaria']['pagina']}."
    return principal


def main(especies_json, pasta_fotos, catalogo, saida, pf_json=None, pasta_fotos_pf=None):
    por_nome, por_id = catalogo_jbrj(catalogo)
    fotos_por_ficha = json.load(open(os.path.join(pasta_fotos, "fotos.json"), encoding="utf-8"))
    plantas, sem_jbrj = [], []
    for e in json.load(open(especies_json, encoding="utf-8")):
        fotos = fotos_da_ficha(fotos_por_ficha.get(f"{e['volume']}:{e['pagina_pdf']}", []), pasta_fotos)
        r = registro(e, fotos, por_nome, por_id)
        if not r["id"].startswith("jbrj-"):
            sem_jbrj.append(e["nome_cientifico_titulo"])
        plantas.append(r)
    por_chave = {p["identificacao"]["nome_cientifico"]: p for p in plantas}
    fundidas = 0
    if pf_json:
        fotos_pf = json.load(open(os.path.join(pasta_fotos_pf, "fotos.json"), encoding="utf-8")) if pasta_fotos_pf else {}
        for e in json.load(open(pf_json, encoding="utf-8")):
            if e["nome_cientifico_titulo"] == "?":  # portfólio cujo texto veio fora de ordem (2 de 145): sem nome científico não dá para ligar
                continue
            r = registro_pf(e, por_nome, por_id)
            r["fotos"] = [{"src": data_url(os.path.join(pasta_fotos_pf, f["arquivo"])), "legenda": f["legenda"], "credito": f["credito"]}
                          for f in fotos_pf.get(str(e["pagina_pdf"]), []) if not f.get("descartada")]
            existente = por_chave.get(r["identificacao"]["nome_cientifico"])
            if existente:
                fundir(existente, r)
                fundidas += 1
            else:
                plantas.append(r)
                por_chave[r["identificacao"]["nome_cientifico"]] = r
    print(fundidas, "portfólios do Sul fundidos com fichas de Carvalho")
    pacote = {
        "versao_esquema": "1.0.0", "titulo": "Embrapa — Espécies Arbóreas Brasileiras (Carvalho) e Plantas para o Futuro (Sul): fichas, referências e fotos", "idioma": "pt-BR",
        "data_compilacao": datetime.date.today().isoformat(),
        "criterios": {"fonte": "CARVALHO, P. E. R. Espécies arbóreas brasileiras, vols. 1–5. Embrapa Florestas, 2003–2014; e Plantas para o Futuro — Região Sul (MMA/Embrapa, 2011).",
                      "extracao": "Texto e fotos extraídos dos PDFs por regras (ferramentas/extrair_carvalho.py, carvalho_fotos.py); campos só quando o texto os afirma.",
                      "uso": "Arquivo de uso pessoal/local: texto e fotos têm direitos da Embrapa e dos fotógrafos citados."},
        "fontes_referencia": [{"titulo": "Espécies Arbóreas Brasileiras", "tipo": "livro", "volumes": 5}],
        "quantidade_especies": len(plantas), "plantas": plantas,
    }
    json.dump(pacote, open(saida, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # A variante sem fotos (~5x menor, para celulares): mesmo nome trocando "com_fotos" por "sem_fotos" (01a → 01b).
    sem_fotos = saida.replace("01a_embrapa_com_fotos", "01b_embrapa_sem_fotos") if "01a_embrapa_com_fotos" in saida else saida.replace(".json", "_sem_fotos.json")
    for planta in pacote["plantas"]:
        planta["fotos"] = []
    json.dump(pacote, open(sem_fotos, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(plantas), "espécies;", len(sem_jbrj), "sem correspondência no JBRJ:", sem_jbrj[:12], "|", os.path.getsize(saida) // 1024 // 1024, "MB")


if __name__ == "__main__":
    main(*sys.argv[1:7])
