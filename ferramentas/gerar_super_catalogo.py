#!/usr/bin/env python3
"""Gera o "super catálogo" da biblioteca do PlantaTerra a partir do DwC-A da Flora e Funga do Brasil (JBRJ, CC BY 4.0).

Uso: python3 ferramentas/gerar_super_catalogo.py <pasta_dwca_extraida> <pasta_saida>

Saída: 03_catalogo_nacional.jsonl.gz — 1ª linha = cabeçalho (formato plantaterra-catalogo-nacional, versão 2), depois UM
REGISTRO POR TÁXON (todos os níveis: espécies, variedades, gêneros, famílias…, aceitos e sinônimos), em chaves curtas
documentadas em docs/especificacao.md §15.2 e em `dominio/catalogo_nacional.js`. O app importa em streaming para o
store "catalogo" do IndexedDB. Só o que a fonte afirma entra; o resto fica ausente (nunca inferido).
"""
import csv, json, sys, collections, datetime, os

csv.field_size_limit(10**9)
UFS = {"AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal",
       "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul",
       "MG": "Minas Gerais", "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí",
       "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima",
       "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins"}


def ler(pasta, nome):
    with open(os.path.join(pasta, nome), encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)


def json_ou_vazio(texto):
    try:
        return json.loads(texto) if texto else {}
    except ValueError:
        return {}


def principal(*grupos):
    return [x for g in grupos for x in g]


RANGOS = {"ESPECIE": "sp", "VARIEDADE": "var", "SUB_ESPECIE": "ssp", "FORMA": "f", "GENERO": "gen", "FAMILIA": "fam", "ORDEM": "ord",
          "CLASSE": "cla", "TRIBO": "tri", "DIVISAO": "div", "SUB_FAMILIA": "sfam"}
RELACOES = {"É sinônimo BASIONIMO": "sb", "É sinônimo HOMOTIPICO": "sh", "É sinônimo HETEROTIPICO": "sx",
            "Tem como sinônimo BASIONIMO": "tb", "Tem como sinônimo HOMOTIPICO": "th", "Tem como sinônimo HETEROTIPICO": "tx"}


def agrupar(pasta, nome, chave="id"):
    grupos = collections.defaultdict(list)
    for linha in ler(pasta, nome):
        grupos[linha[chave]].append(linha)
    return grupos


def main(pasta, saida):
    import gzip, re
    taxa = list(ler(pasta, "taxon.txt"))

    nomes = collections.defaultdict(lambda: collections.defaultdict(list))
    locais = collections.defaultdict(dict)
    for v in ler(pasta, "vernacularname.txt"):
        nome = v["vernacularName"].strip()
        if not nome:
            continue
        lista = nomes[v["id"]][v["language"]]
        if nome not in lista:
            lista.append(nome)
        if v["language"] == "PORTUGUES" and v["locality"]:
            locais[v["id"]][nome] = v["locality"]

    perfil = {p["id"]: json_ou_vazio(p["lifeForm"]) for p in ler(pasta, "speciesprofile.txt") if p["lifeForm"]}

    distribuicao = collections.defaultdict(lambda: {"ufs": set(), "nativa": set(), "exotica": set(), "meios": set(), "endemismo": set(), "dominios": set()})
    for d in ler(pasta, "distribution.txt"):
        acc = distribuicao[d["id"]]
        uf = d["locationID"][3:] if d["locationID"].startswith("BR-") else ""
        if uf in UFS:
            acc["ufs"].add(uf)
            if d["establishmentMeans"] == "Nativa":
                acc["nativa"].add(uf)
            elif d["establishmentMeans"] == "Exótica":
                acc["exotica"].add(uf)
        if d["establishmentMeans"]:
            acc["meios"].add(d["establishmentMeans"])
        extra = json_ou_vazio(d["occurrenceRemarks"])
        if extra.get("endemism"):
            acc["endemismo"].add(extra["endemism"])
        acc["dominios"].update(extra.get("phytogeographicDomain") or [])

    relacoes = collections.defaultdict(list)
    for r in ler(pasta, "resourcerelationship.txt"):
        relacoes[r["id"]].append([r["relatedResourceID"], RELACOES.get(r["relationshipOfResource"], "?")])

    referencias = agrupar(pasta, "reference.txt")
    tipos = agrupar(pasta, "typesandspecimen.txt")

    eml = open(os.path.join(pasta, "eml.xml"), encoding="utf-8").read()
    pacote = re.search(r'packageId="([^"]+)"', eml)
    publicado = re.search(r"<pubDate>\s*([^<\s]+)", eml)

    os.makedirs(saida, exist_ok=True)
    caminho = os.path.join(saida, "03_catalogo_nacional.jsonl.gz")
    contagem = collections.Counter()
    with gzip.open(caminho, "wt", encoding="utf-8", compresslevel=9) as f:
        cabecalho = {
            "formato": "plantaterra-catalogo-nacional", "formato_versao": 2,
            "fonte": "Flora e Funga do Brasil — Lista oficial (JBRJ), Darwin Core Archive, CC BY 4.0.",
            "citacao": "Flora e Funga do Brasil. Jardim Botânico do Rio de Janeiro. Disponível em: http://floradobrasil.jbrj.gov.br.",
            "versao_fonte": pacote.group(1) if pacote else None,
            "publicado_em": publicado.group(1) if publicado else None,
            "escopo": "Todos os táxons: espécies, infraespécies, gêneros e níveis superiores, aceitos e sinônimos, de todos os reinos.",
            "gerado_em": datetime.date.today().isoformat()
        }
        f.write(json.dumps(cabecalho, ensure_ascii=False) + "\n")
        for t in sorted(taxa, key=lambda t: t["scientificName"]):
            id_ = t["id"]
            nome, autoria = t["scientificName"], t["scientificNameAuthorship"]
            canonico = nome[:-len(autoria)].strip() if autoria and nome.endswith(autoria) else nome
            r = {"id": id_, "c": canonico, "k": RANGOS.get(t["taxonRank"], t["taxonRank"].lower())}
            if autoria:
                r["a"] = autoria
            if t["taxonomicStatus"] == "NOME_ACEITO":
                r["st"] = "A"
            elif t["taxonomicStatus"] == "SINONIMO":
                r["st"] = "S"
            for chave, campo in (("ns", "nomenclaturalStatus"), ("ai", "acceptedNameUsageID"), ("pi", "parentNameUsageID"),
                                 ("oi", "originalNameUsageID"), ("pub", "namePublishedIn"), ("ano", "namePublishedInYear"),
                                 ("f", "family"), ("r", "kingdom"), ("fi", "phylum"), ("cl", "class"), ("or", "order"), ("g", "genus")):
                if t[campo] and t[campo] != "NA":
                    r[chave] = t[campo]
            if t["modified"]:
                r["md"] = t["modified"][:10]
            if id_ in nomes:
                if nomes[id_].get("PORTUGUES"):
                    r["p"] = nomes[id_]["PORTUGUES"]
                if locais.get(id_):
                    r["pv"] = locais[id_]
                outros = {k.lower(): v for k, v in nomes[id_].items() if k != "PORTUGUES"}
                if outros:
                    r["n"] = outros
            dist = distribuicao.get(id_)
            if dist:
                if "Nativa" in dist["meios"]:
                    r["o"] = "nativa"
                elif "Exótica" in dist["meios"]:
                    r["o"] = "exótica"
                for chave, valor in (("uf", dist["ufs"]), ("ufn", dist["nativa"]), ("ufe", dist["exotica"]),
                                     ("d", dist["dominios"]), ("e", dist["endemismo"])):
                    if valor:
                        r[chave] = sorted(valor)
            pf = perfil.get(id_, {})
            if pf.get("lifeForm"):
                r["v"] = [x.lower() for x in pf["lifeForm"]]
            if pf.get("habitat"):
                r["h"] = pf["habitat"]
            if pf.get("vegetationType"):
                r["vg"] = pf["vegetationType"]
            if id_ in relacoes:
                r["rel"] = relacoes[id_]
            if id_ in referencias:
                r["rf"] = [[x["bibliographicCitation"], x["title"], x["creator"], x["date"], x["type"], x["identifier"]]
                           for x in referencias[id_]]
            if id_ in tipos:
                r["tp"] = [[x["typeStatus"], x["collectionCode"], x["catalogNumber"], x["locality"], x["recordedBy"], x["source"]]
                           for x in tipos[id_]]
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
            contagem[t["taxonRank"]] += 1
    print(caminho, sum(contagem.values()), dict(contagem), os.path.getsize(caminho) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
