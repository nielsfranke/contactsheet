# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Download a curated pool of CC0 photos from Openverse for the demo instance.

Photos are filtered to license=cc0 so the README's CC0 credit stays valid. Downloaded into
demo/assets/_pool/<category>/, downsized to <=1600px long edge, with attribution recorded in
_pool/meta.json. A per-category montage is written for visual review before final selection.

Run:  backend/.venv/bin/python demo/fetch_assets.py
"""

from __future__ import annotations

import io
import json
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
POOL = HERE / "assets" / "_pool"
UA = "ContactSheet-demo-fetch/1.0 (https://github.com/nielsfranke/contactsheet)"
MAX_EDGE = 1600

# category -> search terms. Professional categories: landscape / travel / architecture / studio.
QUERIES: dict[str, list[str]] = {
    "coastal": ["coast cliff sea", "mountain fog landscape", "fjord nordic landscape"],
    "iceland": ["iceland landscape", "waterfall nature", "glacier mountain"],
    "architecture": ["modern architecture facade", "minimal building exterior", "concrete architecture"],
    "editorial": ["black and white portrait", "studio portrait", "street photography city"],
}
PER_CATEGORY = 8  # download candidates per category (over-fetch; final selection is smaller)


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def _downsize(raw: bytes) -> Image.Image | None:
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        return None
    img.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    # Reject tiny/unusable images.
    if min(img.size) < 600:
        return None
    return img


def fetch_category(cat: str, terms: list[str], meta: dict) -> None:
    out = POOL / cat
    out.mkdir(parents=True, exist_ok=True)
    got = 0
    seen: set[str] = set()
    for term in terms:
        if got >= PER_CATEGORY:
            break
        q = urllib.parse.quote(term)
        url = (
            f"https://api.openverse.org/v1/images/?q={q}&license=cc0"
            f"&page_size=12&mature=false&aspect_ratio=wide,square"
        )
        try:
            data = _get_json(url)
        except Exception as e:
            print(f"  ! query failed ({term}): {e}")
            continue
        for res in data.get("results", []):
            if got >= PER_CATEGORY:
                break
            src = res.get("url")
            if not src or src in seen:
                continue
            seen.add(src)
            try:
                img = _downsize(_download(src))
            except Exception:
                img = None
            if img is None:
                continue
            name = f"{cat}-{got:02d}.jpg"
            img.save(out / name, "JPEG", quality=88)
            meta[f"{cat}/{name}"] = {
                "title": res.get("title"),
                "creator": res.get("creator"),
                "creator_url": res.get("creator_url"),
                "source": res.get("source"),
                "foreign_landing_url": res.get("foreign_landing_url"),
                "license": res.get("license"),
                "license_version": res.get("license_version"),
                "license_url": res.get("license_url"),
            }
            got += 1
            print(f"  + {name}  <- {src}")
    print(f"{cat}: {got} images")


def build_montage() -> None:
    """One montage per category for quick visual review (thumbnails in a grid)."""
    for cat in QUERIES:
        files = sorted((POOL / cat).glob("*.jpg"))
        if not files:
            continue
        cols = 4
        cell = 320
        rows = (len(files) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * cell), (24, 24, 27))
        for i, f in enumerate(files):
            t = Image.open(f).convert("RGB")
            t.thumbnail((cell - 8, cell - 8), Image.Resampling.LANCZOS)
            x = (i % cols) * cell + (cell - t.width) // 2
            y = (i // cols) * cell + (cell - t.height) // 2
            sheet.paste(t, (x, y))
        sheet.save(POOL / f"_montage-{cat}.jpg", "JPEG", quality=85)
        print(f"montage: _montage-{cat}.jpg ({len(files)} imgs)")


def main() -> None:
    POOL.mkdir(parents=True, exist_ok=True)
    meta: dict = {}
    for cat, terms in QUERIES.items():
        print(f"== {cat} ==")
        fetch_category(cat, terms, meta)
    (POOL / "meta.json").write_text(json.dumps(meta, indent=2))
    build_montage()
    print(f"\nDone. Pool at {POOL}")


if __name__ == "__main__":
    main()
