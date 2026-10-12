"""One-off seed: writes src/content/products/*.md and src/content/events/*.md
from the audit data (src/data/products.json + handoff evidence).

Run from site/ after extract-data.py and normalize-media.mjs:
    python -I scripts/generate-content.py
Existing entry files are NOT overwritten (the CMS owns them after seeding).
"""
import json
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
MEDIA = SITE / "src" / "assets" / "media"
products = json.loads((SITE / "src/data/products.json").read_text(encoding="utf-8"))


def q(s):
    return json.dumps(s, ensure_ascii=False)


def media_path(media_id):
    stem = media_id.rsplit(".", 1)[0].replace("~", "_").replace("%20", "_").replace(" ", "_")
    f = MEDIA / f"{stem}.webp"
    assert f.exists(), f
    return f"../../assets/media/{f.name}"


CATEGORY = {
    "Cappotto": "Capispalla", "Bomber": "Capispalla", "Giacca": "Capispalla", "Capospalla": "Capispalla",
    "Blazer": "Capispalla", "Maglia": "Maglieria e polo", "Polo": "Maglieria e polo",
    "T-Shirt": "Maglieria e polo", "Cardigan": "Maglieria e polo", "Camicia": "Camicie",
    "Kilt": "Pantaloni e gonne",
}

out_dir = SITE / "src/content/products"
out_dir.mkdir(parents=True, exist_ok=True)
for p in products:
    f = out_dir / f'{p["slug"]}.md'
    if f.exists():
        continue
    d = p["details"]
    lines = ["---",
             f'title: {q(p["title"])}',
             f'price: {p["price"]:.2f}',
             f'size: {q(p["size"]) if p["size"] else "null"}',
             f'category: {q(CATEGORY[p["title"].split()[0]])}',
             "available: true",
             "quantity: 1",
             f'order: {p["listingOrder"]}',
             f'featured: {"true" if p["listingOrder"] in (1, 4, 15, 18) else "false"}',
             "images:"]
    lines += [f'  - {q(media_path(i["media"]))}' for i in p["images"]]
    lines.append("details:")
    for k in ("misure", "materiale"):
        if d[k]:
            lines.append(f"  {k}:")
            lines += [f"    - {q(v)}" for v in d[k]]
        else:
            lines.append(f"  {k}: []")
    lines.append(f'  stato: {q(d["stato"][0]) if d["stato"] else "null"}')
    lines.append(f'  anni: {q(" ".join(d["anni"])) if d["anni"] else "null"}')
    lines.append("---")
    lines.append("")
    lines += [para + "\n" for para in p["description"]]
    f.write_text("\n".join(lines), encoding="utf-8")

events = [
    {
        "slug": "fuori-serie", "title": "Fuori serie", "start": "2026-09-25T15:00:00+02:00", "end": None,
        "poster": "0bf791_04b4dd219dba46daae973e15e4425f1b~mv2.jpg",
        "tagline": "FOR PEOPLE WHO DON'T FIT THE STANDARD",
        "body": ["Live fashion editorial ( vivi da vicino la creazione di un vero editoriale di moda )",
                 "Styling , make-up ,shooting , backstage.",
                 "Free 10 minuti styling ( delle stylist a tua disposizione per creare un look con capi vintage )"],
    },
    {
        "slug": "aperitivo-e-tarocchi", "title": "Aperitivo e Tarocchi", "start": "2026-05-22T18:00:00+02:00",
        "end": "2026-05-22T21:00:00+02:00", "poster": "0bf791_7ca43929846b4b279a22e401ab1c05a3~mv2.jpg",
        "tagline": None,
        "body": ["L’ evento si svolgerà nel nostro negozio , puoi prenotare la tua seduta ( offerta libera ) di lettura dei tarocchi .",
                 "L’ aperitivo lo offriamo noi ."],
    },
    {
        "slug": "operamia", "title": "Operamia", "start": "2026-03-12T10:30:00+01:00", "end": None,
        "poster": "0bf791_2bf8720820054047b70ad5df9e36caa5~mv2.jpg", "tagline": "Live painting",
        "body": ["Live painting", "Capi e accessori dipinto dal vivo"],
    },
]
ev_dir = SITE / "src/content/events"
ev_dir.mkdir(parents=True, exist_ok=True)
for e in events:
    f = ev_dir / f'{e["slug"]}.md'
    if f.exists():
        continue
    lines = ["---", f'title: {q(e["title"])}', f'start: {e["start"]}']
    if e["end"]:
        lines.append(f'end: {e["end"]}')
    lines += [f'poster: {q(media_path(e["poster"]))}',
              'venue: "Via Giulio e Corrado Venini, 54"',
              "registration: chiusa",
              "registrationUrl: null"]
    if e["tagline"]:
        lines.append(f'tagline: {q(e["tagline"])}')
    lines += ["---", ""] + [b + "\n" for b in e["body"]]
    f.write_text("\n".join(lines), encoding="utf-8")

print("seeded", len(products), "products and", len(events), "events")
