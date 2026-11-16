# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Seed the isolated demo instance (demo/.data) with the manifest content via the REST API.

Wipes demo/.data, runs migrations, launches the demo backend on :8099, then drives the public
API to create the branding, galleries, sub-galleries, photo uploads, and collaboration content.
Writes demo/.data/state.json (gallery ids + share tokens) for the capture script, then stops
the backend. Never touches the developer's real instance.

Run:  backend/.venv/bin/python demo/seed_demo.py
"""

from __future__ import annotations

import json
import math
import random
import shutil
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import manifest  # noqa: E402
from _common import (  # noqa: E402
    API_BASE,
    API_PORT,
    ASSETS,
    DATA,
    STATE_FILE,
    WEB_PORT,
    ensure_dirs,
    run_migrations,
    start_backend,
    stop,
)


def _assets(folder: str) -> list:
    files = sorted((ASSETS / folder).glob("*.jpg"))
    prefix = manifest.FILENAME_PREFIX.get(folder, "IMG_")
    start = 1000 + 37 * len(folder)  # arbitrary but stable "frame counter" per shoot
    return [
        ("files", (f"{prefix}{start + 3 * i:04d}.jpg", f.read_bytes(), "image/jpeg"))
        for i, f in enumerate(files)
    ]


def _wait_for_processing(client: httpx.Client, gid: str, expected: int) -> None:
    """Block until all uploaded images have their thumbnail rendition ready."""
    for _ in range(60):
        imgs = client.get(f"/api/galleries/{gid}/images").json()
        ready = [i for i in imgs if i.get("thumb_url") or i.get("video_url")]
        if len(ready) >= expected:
            return
        time.sleep(1)
    print(f"  ! warning: processing slow for {gid} ({len(ready)}/{expected})")


def _create_gallery(client: httpx.Client, spec: dict, state: dict, parent_id: str | None) -> None:
    payload = {"name": spec["name"], "mode": spec.get("mode", "presentation")}
    if parent_id:
        payload["parent_id"] = parent_id
    if spec.get("headline"):
        payload["headline"] = spec["headline"]
    g = client.post("/api/galleries", json=payload).raise_for_status().json()
    gid, token = g["id"], g["share_token"]

    if spec.get("settings"):
        client.patch(f"/api/galleries/{gid}", json=spec["settings"]).raise_for_status()

    image_ids: list[str] = []
    if spec.get("assets"):
        files = _assets(spec["assets"])
        uploaded = client.post(f"/api/galleries/{gid}/images", files=files).raise_for_status().json()
        image_ids = [u["id"] for u in uploaded]
        _wait_for_processing(client, gid, len(files))

    # Optional full-width hero banner: promote one uploaded photo to the gallery header.
    if spec.get("header_image") is not None and image_ids:
        client.post(
            f"/api/galleries/{gid}/header-image/from-image",
            json={"image_id": image_ids[spec["header_image"]]},
        ).raise_for_status()

    state["galleries"][spec["key"]] = {
        "id": gid,
        "share_token": token,
        "name": spec["name"],
        "image_ids": image_ids,
    }
    print(f"  gallery '{spec['name']}' ({spec.get('mode')}) — {len(image_ids)} photos")

    for child in spec.get("children", []):
        _create_gallery(client, child, state, parent_id=gid)


def _seed_collab(client: httpx.Client, spec: dict, state: dict) -> None:
    collab = spec.get("collab")
    if not collab:
        return
    token = state["galleries"][spec["key"]]["share_token"]
    ids = state["galleries"][spec["key"]]["image_ids"]

    def img(i: int) -> str:
        return ids[i]

    base = f"/api/public/g/{token}/images"
    for i, flag in collab.get("flags", {}).items():
        client.post(f"{base}/{img(i)}/flag", json={"flag": flag}).raise_for_status()
    for i, stars in collab.get("ratings", {}).items():
        client.post(f"{base}/{img(i)}/rate", json={"rating": stars}).raise_for_status()
    for reviewer, idxs in collab.get("likes", {}).items():
        for i in idxs:
            client.post(f"{base}/{img(i)}/like", json={"reviewer": reviewer}).raise_for_status()
    for c in collab.get("comments", []):
        client.post(
            f"{base}/{img(c['image'])}/comments",
            json={"author_name": c["author"], "text": c["text"]},
        ).raise_for_status()
    for a in collab.get("annotations", []):
        e = a["ellipse"]
        points = [
            {"x": round(e["cx"] + e["rx"] * math.cos(t), 4), "y": round(e["cy"] + e["ry"] * math.sin(t), 4)}
            for t in (2 * math.pi * k / 48 for k in range(49))
        ]
        client.post(
            f"{base}/{img(a['image'])}/comments",
            json={
                "author_name": a["author"],
                "text": a["text"],
                "anchor": {"type": "freehand", "points": points, "color": "#ef4444"},
            },
        ).raise_for_status()
    print(f"  collaboration seeded on '{spec['name']}'")


def _seed_history(state: dict) -> None:
    """Backdate a couple of months of plausible client activity straight into the demo DB (backend stopped),
    so the analytics charts show a trend instead of a single spike on seed day. Deterministic."""
    rng = random.Random(2024)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = []
    for key in manifest.HISTORY_GALLERIES:
        g = state["galleries"][key]
        weight = 3 if key == "editorial" else 1
        for day in range(1, manifest.HISTORY_DAYS + 1):
            # A slow upward drift plus a delivery spike ~10 days ago, with day-to-day noise.
            drift = 0.9 + 0.4 * (1 - day / manifest.HISTORY_DAYS)
            base = weight * (drift + 0.9 * math.exp(-((day - 10) ** 2) / 30))
            for action, scale, author_pool in (
                ("viewed", 2.0, ["Guest"]),
                ("downloaded", 0.25, ["Guest"]),
                ("flagged", 0.5, manifest.HISTORY_REVIEWERS),
                ("liked", 0.6, manifest.HISTORY_REVIEWERS),
                ("rated", 0.4, manifest.HISTORY_REVIEWERS),
                ("commented", 0.15, manifest.HISTORY_REVIEWERS),
            ):
                if action not in ("viewed", "downloaded") and key != "editorial":
                    continue
                for _ in range(max(0, round(rng.gauss(base * scale, base * scale / 3)))):
                    ts = now - timedelta(days=day, seconds=rng.randint(0, 86399))
                    image_id = (
                        rng.choice(g["image_ids"]) if action not in ("viewed", "downloaded") and g["image_ids"] else None
                    )
                    ip = f"198.51.100.{rng.randint(2, 250)}" if action in ("viewed", "downloaded") else None
                    rows.append((str(uuid.uuid4()), g["id"], image_id, action, rng.choice(author_pool), None, ip,
                                 ts.strftime("%Y-%m-%d %H:%M:%S.%f")))
    con = sqlite3.connect(DATA / "demo.db")
    with con:
        con.executemany(
            "INSERT INTO activities (id, gallery_id, image_id, action, author, meta, ip, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        # Mark everything but the review gallery as already opened, so only it shows "New".
        seen = (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=1)).strftime("%Y-%m-%d %H:%M:%S.%f")
        ids = [state["galleries"][k]["id"] for k in manifest.SEEN_GALLERIES]
        con.executemany("UPDATE galleries SET admin_seen_at = ? WHERE id = ?", [(seen, i) for i in ids])
    con.close()
    print(f"  {len(rows)} backdated activity rows written")


def seed() -> None:
    state: dict = {
        "api_port": API_PORT,
        "web_port": WEB_PORT,
        "admin": manifest.ADMIN,
        "scenes": manifest.SCENES,
        "galleries": {},
    }
    with httpx.Client(base_url=API_BASE, timeout=120) as client:
        # 1. Setup (tolerate already-complete) + login.
        r = client.post("/api/setup", json=manifest.ADMIN)
        if r.status_code not in (201, 409):
            r.raise_for_status()
        client.post("/api/auth/login", json={**manifest.ADMIN, "remember": True}).raise_for_status()

        # 2. Branding + footer.
        client.patch("/api/admin/settings", json=manifest.SETTINGS).raise_for_status()
        print("  branding + footer applied")

        # 3. Galleries (+ sub-galleries, uploads).
        for spec in manifest.GALLERIES:
            _create_gallery(client, spec, state, parent_id=None)

        # 4. Collaboration content.
        for spec in manifest.GALLERIES:
            _seed_collab(client, spec, state)

    STATE_FILE.write_text(json.dumps(state, indent=2))
    print(f"\nState written to {STATE_FILE}")


def main() -> None:
    print("Wiping demo/.data and reseeding…")
    if DATA.exists():
        shutil.rmtree(DATA)
    ensure_dirs()
    run_migrations()
    backend = start_backend()
    try:
        seed()
    finally:
        stop(backend)
    _seed_history(json.loads(STATE_FILE.read_text()))
    print("Seed complete; backend stopped.")


if __name__ == "__main__":
    main()
