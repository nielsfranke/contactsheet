# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Reproduction test for Matthias' header/cover drag-and-drop report (v1.8.0/1.8.1).

Drives a REAL browser: opens the header/cover dialog and fires a genuine native `drop` event whose
`dataTransfer` carries a real JPEG File — exactly what dropping a file from Finder does — for small
AND large files. Asserts a success toast (not "field required" / "[object Object]"). Also checks the
no-file drop (an internal, non-file drag) shows the friendly hint instead of forwarding a broken
request. See docs/architecture/e2e-smoke-tests.md."""

import base64
import io

from PIL import Image

ADMIN_USER = "e2e_admin"
ADMIN_PASS = "e2e-supersecret-123"


def _jpeg(size, quality=95) -> bytes:
    """A valid JPEG. Random noise so it compresses poorly → controllable, realistic byte size."""
    import os

    buf = io.BytesIO()
    Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3)).save(
        buf, format="JPEG", quality=quality
    )
    return buf.getvalue()


def _ensure_logged_in(page, frontend_url):
    status = page.request.get(f"{frontend_url}/api/setup/status").json()
    if not status.get("setup_complete"):
        page.goto(f"{frontend_url}/setup")
        page.fill("#username", ADMIN_USER)
        page.fill("#password", ADMIN_PASS)
        page.fill("#confirm", ADMIN_PASS)
        page.click("button[type=submit]")
        page.wait_for_url("**/login", timeout=30_000)
    page.goto(f"{frontend_url}/login")
    page.fill("#username", ADMIN_USER)
    page.fill("#password", ADMIN_PASS)
    page.click("button[type=submit]")
    page.wait_for_url("**/admin/galleries", timeout=30_000)


def _drop_file(page, selector, filename, buffer: bytes, mime="image/jpeg"):
    """Fire a real dragenter/dragover/drop on `selector` with a File in the DataTransfer — the exact
    shape a Finder/Explorer file drop produces."""
    b64 = base64.b64encode(buffer).decode()
    page.eval_on_selector(
        selector,
        """(el, {b64, filename, mime}) => {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const file = new File([bytes], filename, { type: mime });
            const dt = new DataTransfer();
            dt.items.add(file);
            for (const type of ['dragenter', 'dragover', 'drop']) {
                el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
            }
        }""",
        {"b64": b64, "filename": filename, "mime": mime},
    )


def _drop_nonfile(page, selector):
    """Fire a drop with NO files (an internal on-page image drag / text drag)."""
    page.eval_on_selector(
        selector,
        """(el) => {
            const dt = new DataTransfer();
            dt.setData('text/uri-list', 'http://example/photo.jpg');
            dt.setData('text/html', '<img src="http://example/photo.jpg">');
            for (const type of ['dragenter', 'dragover', 'drop']) {
                el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
            }
        }""",
    )


def _assert_no_error(page):
    """No raw server error leaked into a toast."""
    for bad in ("field required", "[object Object]", "Field required"):
        assert page.get_by_text(bad, exact=False).count() == 0, f"unexpected error toast: {bad!r}"


def test_header_and_cover_file_drop(page, frontend_url):
    page.on("pageerror", lambda e: print(f"  [pageerror] {e}"))
    _ensure_logged_in(page, frontend_url)
    api = page.request

    # Empty gallery → the detail page shows the "Set Header/Cover Image" buttons and no photo grid.
    gid = api.post(
        f"{frontend_url}/api/galleries",
        data={"name": "Drop Test", "mode": "presentation"},
    ).json()["id"]

    page.goto(f"{frontend_url}/admin/galleries/{gid}")

    # ---- HEADER: small file drop -------------------------------------------------------------
    page.get_by_role("button", name="Set Header Image").click()
    dropzone = '[role="dialog"] .border-dashed'
    page.wait_for_selector(dropzone, timeout=10_000)

    small = _jpeg((1200, 800))
    print(f"\n[header] small JPEG = {len(small)/1e6:.1f} MB")
    _drop_file(page, dropzone, "finder-photo.jpg", small)
    page.get_by_text("Header image updated", exact=False).wait_for(timeout=30_000)
    _assert_no_error(page)
    print("[header] small drop → success toast ✓")

    # ---- HEADER: LARGE file drop (~40 MB, like Matthias' originals) --------------------------
    large = _jpeg((8000, 6000))  # 48 MP noise → tens of MB, well under the 100 MB header cap
    print(f"[header] large JPEG = {len(large)/1e6:.1f} MB")
    _drop_file(page, dropzone, "finder-BIG.jpg", large)
    # The success toast text is the same; wait for a fresh one by first letting any prior toast clear.
    page.wait_for_timeout(500)
    _drop_file(page, dropzone, "finder-BIG2.jpg", large)
    page.get_by_text("Header image updated", exact=False).wait_for(timeout=60_000)
    _assert_no_error(page)
    print("[header] large drop → success toast ✓")

    # ---- HEADER: non-file drop → friendly hint, NOT a raw error -----------------------------
    _drop_nonfile(page, dropzone)
    page.get_by_text("Drag an image file from your computer", exact=False).wait_for(timeout=10_000)
    _assert_no_error(page)
    print("[header] non-file drop → friendly hint ✓")

    page.keyboard.press("Escape")

    # ---- COVER: small + large file drop -----------------------------------------------------
    page.get_by_role("button", name="Set Cover Image").click()
    page.wait_for_selector(dropzone, timeout=10_000)
    _drop_file(page, dropzone, "cover-small.jpg", small)
    page.get_by_text("Cover image updated", exact=False).wait_for(timeout=30_000)
    _assert_no_error(page)
    print("[cover] small drop → success toast ✓")

    page.wait_for_timeout(500)
    _drop_file(page, dropzone, "cover-BIG.jpg", large)
    page.get_by_text("Cover image updated", exact=False).wait_for(timeout=60_000)
    _assert_no_error(page)
    print("[cover] large drop → success toast ✓")


def test_header_over_size_limit_reads_cleanly(page, frontend_url):
    """A file above the 100 MB header cap must answer with a readable detail, not a 422/500 — the
    exact HTTP the browser upload travels (Next rewrite → backend). The frontend renders `detail`
    verbatim via errorDetail(), so a clean string here is what the user sees (no '[object Object]').
    Driven through page.request rather than a browser drop because a >100 MB base64 blob crashes the
    JS heap — a harness limit, not a product one."""
    _ensure_logged_in(page, frontend_url)
    gid = page.request.post(
        f"{frontend_url}/api/galleries", data={"name": "Oversize", "mode": "presentation"}
    ).json()["id"]

    big = _jpeg((10000, 9200))  # ~92 MP noise @ q95 → just over the 100 MB cap
    print(f"\n[oversize] JPEG = {len(big)/1e6:.1f} MB (cap is 100 MB)")
    assert len(big) > 100 * 1024 * 1024, f"generated file only {len(big)} bytes — not over the cap"

    r = page.request.post(
        f"{frontend_url}/api/galleries/{gid}/header-image",
        multipart={"file": {"name": "huge.jpg", "mimeType": "image/jpeg", "buffer": big}},
    )
    assert r.status == 413, f"expected 413, got {r.status}: {r.text()[:200]}"
    assert r.json()["detail"] == "File too large", r.text()
    print("[oversize] over-limit upload → clean 413 'File too large' ✓")
