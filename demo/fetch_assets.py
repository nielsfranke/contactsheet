# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Download a candidate pool of placeholder photos from Lorem Picsum for the demo instance.

Picsum serves curated Unsplash photos (Unsplash license — free to use, no attribution required;
we still record author + source). Photos are fetched deterministically by id into
demo/assets/_pool/NN.jpg with attribution in _pool/meta.json, plus a montage for visual review
before the final selection in select_assets.py.

Run:  backend/.venv/bin/python demo/fetch_assets.py
"""

from __future__ import annotations

import io
import json
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
POOL = HERE / "assets" / "_pool"
UA = "ContactSheet-demo-fetch/1.0 (https://github.com/nielsfranke/contactsheet)"
W, H = 1600, 1067  # 3:2 landscape
POOL_SIZE = 40     # candidates to download (final selection is smaller)


def _get_json(url: str) -> list:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def list_candidates() -> list[dict]:
    """Picsum's photo catalogue (id + author + Unsplash url), landscape-oriented, deduped."""
    out: list[dict] = []
    for page in range(1, 5):
        try:
            entries = _get_json(f"https://picsum.photos/v2/list?page={page}&limit=30")
        except Exception as e:
            print(f"  ! list page {page} failed: {e}")
            continue
        for e in entries:
            if e.get("width", 0) >= e.get("height", 0):  # landscape only
                out.append(e)
        if len(out) >= POOL_SIZE:
            break
    return out[:POOL_SIZE]


def main() -> None:
    POOL.mkdir(parents=True, exist_ok=True)
    for f in POOL.glob("*.jpg"):
        f.unlink()
    meta: dict = {}
    got = 0
    for e in list_candidates():
        pid = e["id"]
        try:
            raw = _download(f"https://picsum.photos/id/{pid}/{W}/{H}")
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as ex:
            print(f"  ! id {pid} failed: {ex}")
            continue
        name = f"{got:02d}.jpg"
        img.save(POOL / name, "JPEG", quality=88)
        meta[name] = {"picsum_id": pid, "author": e.get("author"), "url": e.get("url")}
        print(f"  + {name}  <- picsum id {pid}  ({e.get('author')})")
        got += 1
    (POOL / "meta.json").write_text(json.dumps(meta, indent=2))

    # montage for review
    files = sorted(POOL.glob("[0-9]*.jpg"))
    cols, cell = 6, 300
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (24, 24, 27))
    from PIL import ImageDraw

    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        t = Image.open(f).convert("RGB")
        t.thumbnail((cell - 8, cell - 26), Image.Resampling.LANCZOS)
        x, y = (i % cols) * cell, (i // cols) * cell
        sheet.paste(t, (x + (cell - t.width) // 2, y + 20))
        d.text((x + 6, y + 5), f.stem, fill=(230, 230, 230))
    sheet.save(POOL / "_montage.jpg", "JPEG", quality=85)
    print(f"\n{got} images + montage at {POOL}")


if __name__ == "__main__":
    main()
