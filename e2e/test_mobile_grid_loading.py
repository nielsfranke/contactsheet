# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Reproduce + guard the fix for the windowed photo grid not loading all photos.

The shared `WindowedRows` virtualizer must scroll-track whichever element actually scrolls:

* the admin shell is `h-dvh overflow-hidden` with an inner `<main class="overflow-y-auto">` — the
  grid must virtualize against *that* (element scroll). The old `useWindowVirtualizer` never saw
  this scroll, so only the first viewport of rows mounted and a >150-photo gallery rendered blank
  past the first screen — worst on mobile (fewer columns → more rows). `test_mobile_admin_*`.
* the public gallery is `min-h-screen` — the *window* scrolls. This path must keep working too.
  `test_public_*`.

Both drive a real mobile-viewport browser over a >VIRTUALIZE_THRESHOLD gallery, sweep the scroll
container top→bottom and record every distinct tile that mounts. Fixed: nearly all photos appear."""

import io
import time

import httpx
from PIL import Image

ADMIN_USER = "grid_admin"
ADMIN_PASS = "grid-supersecret-123"
N = 170  # > VIRTUALIZE_THRESHOLD (150) so the grid takes the windowed path
MOBILE = {"width": 390, "height": 844}


def _png(i: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), ((i * 7) % 255, (i * 13) % 255, (i * 3) % 255)).save(buf, "PNG")
    return buf.getvalue()


def _setup_or_login(page, frontend_url: str) -> None:
    """First test to run creates the admin via the wizard; later tests just log in (fresh context
    per test → always need the cookie). Order-independent so either test can run first."""
    page.goto(f"{frontend_url}/setup")
    page.wait_for_timeout(800)
    if "/setup" in page.url and page.locator("#confirm").count():
        page.fill("#username", ADMIN_USER)
        page.fill("#password", ADMIN_PASS)
        page.fill("#confirm", ADMIN_PASS)
        page.click("button[type=submit]")
        page.wait_for_url("**/login", timeout=30_000)
    page.goto(f"{frontend_url}/login")
    page.wait_for_selector("#username", timeout=30_000)
    page.fill("#username", ADMIN_USER)
    page.fill("#password", ADMIN_PASS)
    page.click("button[type=submit]")
    page.wait_for_url("**/admin/galleries", timeout=30_000)


def _provision_gallery(page, frontend_url: str, name: str, mode: str) -> tuple[str, str]:
    """Create a gallery with N processed photos; return (gallery_id, share_token)."""
    api = page.request
    r = api.post(f"{frontend_url}/api/galleries", data={"name": name, "mode": mode})
    assert r.ok, r.text()
    gid, share = r.json()["id"], r.json()["share_token"]

    # Bulk upload via httpx (Playwright's request can't put many files under one field), using the
    # browser cookie so the upload still travels the real browser → Next rewrite → backend path.
    cookies = {c["name"]: c["value"] for c in page.context.cookies()}
    with httpx.Client(base_url=frontend_url, cookies=cookies, timeout=120) as client:
        for start in range(0, N, 50):
            batch = range(start, min(start + 50, N))
            files = [("files", (f"img-{i:03d}.png", _png(i), "image/png")) for i in batch]
            resp = client.post(f"/api/galleries/{gid}/images", files=files)
            assert resp.status_code < 400, resp.text

    # Tiles only render once async rendition processing reports done.
    done = 0
    for _ in range(180):
        imgs = api.get(f"{frontend_url}/api/galleries/{gid}/images").json()
        done = sum(1 for i in imgs if i.get("processing_status") == "done")
        if done >= N:
            break
        time.sleep(1)
    assert done >= N, f"only {done}/{N} images finished processing"
    return gid, share


def _sweep(page, selector: str, scroll_js: str, metrics: dict) -> set[str]:
    """Scroll the container top→bottom (driven by `scroll_js`, a JS fn of y) collecting every tile
    (`img[alt^='img-']`) that ever mounts. `selector` matches those tiles."""
    seen: set[str] = set()

    def collect() -> None:
        alts = page.eval_on_selector_all(selector, "els => els.map(e => e.getAttribute('alt'))")
        seen.update(a for a in alts if a)

    collect()
    step = max(1, int(metrics["clientHeight"] * 0.8))
    pos = 0
    while pos < metrics["scrollHeight"]:
        page.evaluate(scroll_js, pos)
        page.wait_for_timeout(250)
        collect()
        pos += step
    page.evaluate(scroll_js, metrics["scrollHeight"])
    page.wait_for_timeout(400)
    collect()
    return seen


def test_mobile_admin_grid_loads_all_photos(page, frontend_url):
    """Admin gallery detail — the grid scrolls the inner `<main>`, not the window."""
    _setup_or_login(page, frontend_url)
    gid, _ = _provision_gallery(page, frontend_url, "Big Admin Gallery", "presentation")

    page.set_viewport_size(MOBILE)
    page.goto(f"{frontend_url}/admin/galleries/{gid}")
    page.wait_for_selector("main img[alt^='img-']", timeout=30_000)
    page.wait_for_timeout(500)

    metrics = page.evaluate(
        """() => {
            const main = document.querySelector('main');
            return {
                mounted: document.querySelectorAll("main img[alt^='img-']").length,
                scrollHeight: main.scrollHeight,
                clientHeight: main.clientHeight,
            };
        }"""
    )
    assert metrics["scrollHeight"] > metrics["clientHeight"] + 200, f"grid does not scroll: {metrics}"
    assert metrics["mounted"] < N, f"not windowed (all {N} mounted): {metrics}"

    seen = _sweep(
        page,
        "main img[alt^='img-']",
        "y => document.querySelector('main').scrollTo(0, y)",
        metrics,
    )
    print(f"\n[admin] distinct tiles seen during full scroll: {len(seen)}/{N}; "
          f"initial DOM tiles: {metrics['mounted']}")
    assert len(seen) >= int(N * 0.95), (
        f"only {len(seen)}/{N} tiles ever mounted while scrolling — photos past the first window "
        f"never loaded (admin inner-scroll windowing regression)"
    )
    assert "img-169.png" in seen and "img-000.png" in seen, "first/last admin tiles never mounted"


def test_public_gallery_grid_loads_all_photos(page, frontend_url):
    """Public gallery — the page itself (`min-h-screen`) scrolls the window. Guards that the
    window-virtualizer path is unchanged by the inner-scroll fix."""
    _setup_or_login(page, frontend_url)
    _, share = _provision_gallery(page, frontend_url, "Big Public Gallery", "collaboration")

    page.set_viewport_size(MOBILE)
    page.goto(f"{frontend_url}/g/{share}")
    page.wait_for_selector("img[alt^='img-']", timeout=30_000)
    page.wait_for_timeout(500)

    metrics = page.evaluate(
        """() => ({
            mounted: document.querySelectorAll("img[alt^='img-']").length,
            scrollHeight: document.documentElement.scrollHeight,
            clientHeight: window.innerHeight,
        })"""
    )
    assert metrics["scrollHeight"] > metrics["clientHeight"] + 200, f"grid does not scroll: {metrics}"
    assert metrics["mounted"] < N, f"not windowed (all {N} mounted): {metrics}"

    seen = _sweep(page, "img[alt^='img-']", "y => window.scrollTo(0, y)", metrics)
    print(f"\n[public] distinct tiles seen during full scroll: {len(seen)}/{N}; "
          f"initial DOM tiles: {metrics['mounted']}")
    assert len(seen) >= int(N * 0.95), (
        f"only {len(seen)}/{N} tiles ever mounted while scrolling — public window-scroll windowing "
        f"regressed"
    )
    assert "img-169.png" in seen and "img-000.png" in seen, "first/last public tiles never mounted"
