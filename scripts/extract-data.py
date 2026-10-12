"""Builds src/data/*.json from the audit handoff (../ relative to site/).

Run from site/:  python -I scripts/extract-data.py
Re-run whenever the handoff evidence changes. Output is the audit baseline,
not live inventory: reconcile with the commerce provider before production.
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

SITE = Path(__file__).resolve().parent.parent
HANDOFF = SITE.parent
OUT = SITE / "src" / "data"
OUT.mkdir(parents=True, exist_ok=True)

pages = json.loads((HANDOFF / "evidence/pages.json").read_text(encoding="utf-8"))
attrs = json.loads((HANDOFF / "evidence/product-attributes.json").read_text(encoding="utf-8"))
routes = json.loads((HANDOFF / "route-inventory.json").read_text(encoding="utf-8"))
manifest = json.loads((HANDOFF / "asset-manifest.json").read_text(encoding="utf-8"))

by_file = {a["file"]: a for a in manifest}
page_by_path = {}
for p in pages:
    path = p["url"].replace("https://www.lqmilano.it", "") or "/"
    page_by_path[path.split("?")[0]] = p

HEADERS = ["Misure", "Materiale", "Stato", "Anni"]
FOOTER = "Giulio e Corrado Venini, 54 20127"


def clean_lines(block):
    out = []
    for line in block.split("\n"):
        s = line.replace("\xa0", " ").strip()
        if s:
            out.append(re.sub(r"\s+", " ", s))
    return out


def section_after(text, header):
    """Text between the `header` line and the next accordion header / footer."""
    lines = text.split("\n")
    # the last occurrence is the accordion (the description never has a bare header line)
    idx = [i for i, l in enumerate(lines) if l.strip() == header]
    if not idx:
        return []
    out = []
    for l in lines[idx[-1] + 1:]:
        s = l.strip()
        if s in HEADERS or s.startswith(FOOTER):
            break
        out.append(l)
    return clean_lines("\n".join(out))


def media_id(file):
    """Stable media identity: the Wix media file name of the canonical source."""
    a = by_file[file]
    return a["canonicalSource"].rsplit("/", 1)[-1]


attr_by_url = {unquote(a["url"]): a["attributes"] for a in attrs}

# Shop listing order, as rendered on /shop?page=2
shop_text = page_by_path["/shop"]["text"]
shop_titles = re.findall(r"Vista rapida\n\n(.+?)\n\nPrezzo", shop_text)

products = []
for r in routes:
    if r["type"] != "product":
        continue
    path = r["path"]
    slug = unquote(path.split("/product-page/", 1)[1])
    page = page_by_path[path]
    text = page["text"]
    m = re.search(r"\n([^\n]+)\n([\d.,]+\s?€)\nPrezzo\n", text)
    title, price_label = m.group(1).strip(), m.group(2)
    price = float(re.sub(r"[^\d,]", "", price_label).replace(",", "."))
    size_m = re.search(r"Taglia\*\n([^\n]+)\n", text)
    size = size_m.group(1).strip() if size_m else None

    after = text.split("Aggiungi al carrello", 1)[1]
    desc_block = re.split(r"\nContinua a leggere\n|\nMisure\n", after, maxsplit=1)[0]
    description = clean_lines(desc_block)
    truncated = "\nContinua a leggere\n" in after

    states = attr_by_url.get(unquote(r["observedUrl"]), {})
    details = {}
    for h in HEADERS:
        val = section_after(states.get(h, ""), h) if h in states else []
        if not val:  # fall back to any state where it happened to be open
            for st in states.values():
                val = section_after(st, h)
                if val:
                    break
        if not val:
            val = section_after(text, h)
        details[h] = val

    imgs = []
    for i in r["images"]:
        if i["alt"].strip() and by_file[i["file"]]["canonicalSource"].split("/")[-1].startswith("0bf791_"):
            mid = media_id(i["file"])
            if mid not in [x["media"] for x in imgs]:
                imgs.append({"media": mid, "handoffFile": i["file"]})

    products.append({
        "slug": slug,
        "path": path,
        "title": title,
        "price": price,
        "currency": "EUR",
        "size": size,
        "description": description,
        "descriptionTruncatedInAudit": truncated,
        "details": {
            "misure": details["Misure"],
            "materiale": details["Materiale"],
            "stato": details["Stato"],
            "anni": details["Anni"],
        },
        "images": imgs,
    })

# order like the shop listing; duplicate titles (Sergio Tacchini) keep route order
order = []
remaining = list(products)
for t in shop_titles:
    for p in remaining:
        if p["title"].replace("  ", " ") == t.replace("  ", " "):
            order.append(p)
            remaining.remove(p)
            break
order += remaining
for n, p in enumerate(order):
    p["listingOrder"] = n + 1

(OUT / "products.json").write_text(json.dumps(order, ensure_ascii=False, indent=2), encoding="utf-8")

# Media list: every canonical source we use, for the downloader
media = {}
for a in manifest:
    if a["kind"] == "image":
        media[a["canonicalSource"].rsplit("/", 1)[-1]] = {
            "canonical": a["canonicalSource"],
            "handoffFile": a["file"],
            "contentType": a["contentType"],
        }
(SITE / "scripts" / "media-sources.json").write_text(json.dumps(media, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"{len(order)} products, {len(media)} media sources")
for p in order:
    d = p["details"]
    print(f'{p["listingOrder"]:>2} {p["title"][:38]:38} {p["price"]:>6} size={p["size"]!s:5} imgs={len(p["images"])} '
          f'mis={len(d["misure"])} mat={len(d["materiale"])} st={d["stato"]} anni={d["anni"]} trunc={p["descriptionTruncatedInAudit"]}')
