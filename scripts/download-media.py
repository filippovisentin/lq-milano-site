"""Downloads master renditions of the site's Wix media into src/assets/media/.

Run from site/:  python -I scripts/download-media.py
Uses scripts/media-sources.json (written by extract-data.py). Files already
present are skipped. Writes src/data/media.json mapping media id -> local file.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DEST = SITE / "src" / "assets" / "media"
DEST.mkdir(parents=True, exist_ok=True)
sources = json.loads((SITE / "scripts" / "media-sources.json").read_text(encoding="utf-8"))

MAGIC = [(b"\xff\xd8\xff", "jpg"), (b"\x89PNG", "png"), (b"RIFF", "webp"), (b"GIF8", "gif")]


def ext_for(data):
    for sig, ext in MAGIC:
        if data.startswith(sig):
            return ext
    if data[4:12] in (b"ftypavif", b"ftypavis"):
        return "avif"
    return None


index = {}
existing = {p.stem: p for p in DEST.iterdir()}
for media, info in sources.items():
    url = info["canonical"]
    if not url.startswith("https://static.wixstatic.com/media/") or media.endswith(".svg"):
        continue
    stem = media.rsplit(".", 1)[0].replace("~", "_").replace("%20", "_").replace(" ", "_")
    if stem in existing:
        index[media] = f"media/{existing[stem].name}"
        continue
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (LQ Milano redesign asset sync)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except Exception as e:  # keep going; report at the end
        print("FAIL", media, e, file=sys.stderr)
        continue
    ext = ext_for(data)
    if not ext or len(data) < 200:
        print("SKIP (not an image)", media, len(data), file=sys.stderr)
        continue
    out = DEST / f"{stem}.{ext}"
    out.write_bytes(data)
    index[media] = f"media/{out.name}"
    print(f"ok {len(data)//1024:>6} KB {out.name}")
    time.sleep(0.15)

(SITE / "src" / "data" / "media.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
print(len(index), "media files indexed")
