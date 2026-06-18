# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Recapture the 12 documentation screenshots against the seeded demo instance.

Launches the demo backend (:8099, against the already-seeded demo/.data) and a demo Next dev
server (:3099, proxied to the demo backend via NEXT_PUBLIC_API_BASE), then drives Playwright
(chromium) through the 12 scenes and writes docs/screenshots/*.jpg. Run `seed_demo.py` first.

Run:  backend/.venv/bin/python demo/capture_screenshots.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    API_BASE,
    REPO,
    STATE_FILE,
    WEB_BASE,
    start_backend,
    start_frontend,
    stop,
)

OUT = REPO / "docs" / "screenshots"
DESKTOP = {"viewport": {"width": 1440, "height": 900}, "device_scale_factor": 2}
MOBILE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 3}
REVIEWER = "Mara Voss"


def shot(page, name: str, clip=None) -> None:
    page.wait_for_timeout(700)  # let images decode / animations settle
    OUT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=82, clip=clip)
    print(f"  ✓ {name}.jpg")


def pad_clip(box, pad=48):
    return {"x": box["x"] - pad, "y": box["y"] - pad, "width": box["width"] + 2 * pad, "height": box["height"] + 2 * pad}


def settle(page) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass


def run(state: dict) -> None:
    g = state["galleries"]
    scenes = state["scenes"]
    coastal = g[scenes["public_showcase"]]["share_token"]
    editorial_token = g[scenes["collaboration"]]["share_token"]
    editorial_id = g[scenes["admin_gallery"]]["id"]
    sessions = g[scenes["nested"]]["share_token"]
    admin = state["admin"]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(**DESKTOP)
        # Pre-seed the reviewer name so the collaboration gallery skips its name prompt.
        ctx.add_init_script(
            "window.localStorage.setItem('contactsheet-reviewer',"
            f" JSON.stringify({{state:{{name:'{REVIEWER}'}},version:0}}));"
            # Admin guard checks this sessionStorage flag; the httponly cookie (added below) does the
            # actual auth. Setting it on public pages too is harmless.
            "try{window.sessionStorage.setItem('cs_admin_authenticated','1');}catch(e){}"
        )
        page = ctx.new_page()
        page.set_default_timeout(30000)

        def go(path: str) -> None:
            page.goto(f"{WEB_BASE}{path}", wait_until="domcontentloaded", timeout=60000)
            settle(page)

        # 01 — login (pre-login, cropped to the card)
        try:
            go("/login")
            card = page.locator('[data-slot="card"]').first
            card.wait_for()
            shot(page, "01-login", clip=pad_clip(card.bounding_box()))
        except Exception as e:
            print(f"  ! 01-login: {e}")

        # Authenticate deterministically: fetch a token from the API and inject it as the request
        # cookie (the Next dev proxy forwards request cookies, but its Set-Cookie handling is
        # unreliable, so the form login wouldn't stick). The client auth flag is set via init script.
        logged_in = False
        try:
            r = httpx.post(f"{API_BASE}/api/auth/login", json={**admin, "remember": True}, timeout=30)
            r.raise_for_status()
            token = r.json()["access_token"]
            ctx.add_cookies([{"name": "access_token", "value": token, "url": WEB_BASE}])
            logged_in = True
        except Exception as e:
            print(f"  ! login failed (admin scenes will be skipped): {e}")

        if logged_in:
            # 02 — admin galleries
            try:
                go("/admin/galleries")
                page.get_by_text("All Galleries").first.wait_for()
                shot(page, "02-admin-galleries")
            except Exception as e:
                print(f"  ! 02: {e}")

            # 03 — create gallery dialog
            try:
                page.get_by_role("button", name="New Gallery").first.click()
                page.get_by_role("dialog").wait_for()
                shot(page, "03-new-gallery-dialog")
                page.keyboard.press("Escape")
            except Exception as e:
                print(f"  ! 03: {e}")

            # 04 — admin gallery detail
            try:
                go(f"/admin/galleries/{editorial_id}")
                page.wait_for_timeout(1200)
                shot(page, "04-admin-gallery")
            except Exception as e:
                print(f"  ! 04: {e}")

            # 10 — gallery settings modal (on the detail page)
            try:
                page.get_by_role("button", name="More actions").first.click()
                page.get_by_role("menuitem", name="Settings").first.click()
                page.get_by_role("dialog").wait_for()
                shot(page, "10-edit-gallery-dialog")
                page.keyboard.press("Escape")
            except Exception as e:
                print(f"  ! 10: {e}")

            # 07 — admin settings (branding)
            try:
                go("/admin/settings/branding")
                page.get_by_text("Studio name").first.wait_for()
                shot(page, "07-admin-settings")
            except Exception as e:
                print(f"  ! 07: {e}")

        # 05 — public showcase header
        try:
            go(f"/g/{coastal}")
            page.wait_for_timeout(1500)
            shot(page, "05-public-gallery")
        except Exception as e:
            print(f"  ! 05: {e}")

        # 06 — lightbox
        try:
            page.locator("button:has(img)").first.click()
            page.wait_for_timeout(1500)
            shot(page, "06-lightbox")
            page.keyboard.press("Escape")
        except Exception as e:
            print(f"  ! 06: {e}")

        # 08 — public nested container
        try:
            go(f"/g/{sessions}")
            page.wait_for_timeout(1200)
            shot(page, "08-public-nested")
        except Exception as e:
            print(f"  ! 08: {e}")

        # 09 — collaboration review (reviewer preset above)
        try:
            go(f"/g/{editorial_token}")
            page.wait_for_timeout(1500)
            shot(page, "09-collaboration-review")
        except Exception as e:
            print(f"  ! 09: {e}")

        # 11 — branding footer (scroll to bottom, clip the footer)
        try:
            go(f"/g/{coastal}")
            page.wait_for_timeout(800)
            page.mouse.wheel(0, 20000)
            page.wait_for_timeout(1000)
            footer = page.locator("footer").last
            box = footer.bounding_box() if footer.count() else None
            shot(page, "11-branding-footer", clip=pad_clip(box, 0) if box else None)
        except Exception as e:
            print(f"  ! 11: {e}")

        ctx.close()

        # 12 — mobile gallery
        try:
            mctx = browser.new_context(**MOBILE)
            mpage = mctx.new_page()
            mpage.goto(f"{WEB_BASE}/g/{coastal}", wait_until="domcontentloaded", timeout=60000)
            try:
                mpage.wait_for_load_state("networkidle", timeout=20000)
            except Exception:
                pass
            mpage.wait_for_timeout(1500)
            mpage.screenshot(path=str(OUT / "12-mobile-gallery.jpg"), type="jpeg", quality=82)
            print("  ✓ 12-mobile-gallery.jpg")
            mctx.close()
        except Exception as e:
            print(f"  ! 12: {e}")

        browser.close()


def main() -> None:
    if not STATE_FILE.exists():
        sys.exit("No demo state — run `backend/.venv/bin/python demo/seed_demo.py` first.")
    state = json.loads(STATE_FILE.read_text())
    backend = start_backend()
    frontend = None
    try:
        frontend = start_frontend()
        print(f"Backend {API_BASE} + frontend {WEB_BASE} up; capturing…")
        run(state)
    finally:
        stop(frontend)
        stop(backend)
    print("Capture complete.")


if __name__ == "__main__":
    main()
