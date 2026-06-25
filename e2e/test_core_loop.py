# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""The core photographer→client journey, end to end through a real browser + real stack.

Auth and the public gallery render go through the browser UI (proving Next SSR, the CSP, the auth
cookie and the rewrites all work together); the data steps use Playwright's request context, which
shares the browser's cookies and still travels the real HTTP path (browser → Next rewrite → FastAPI).
See docs/architecture/e2e-smoke-tests.md."""

import io
import time

from PIL import Image

ADMIN_USER = "e2e_admin"
ADMIN_PASS = "e2e-supersecret-123"


def _png(color=(40, 110, 200), size=(48, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", color=color, size=size).save(buf, format="PNG")
    return buf.getvalue()


def test_core_photographer_client_loop(page, frontend_url):
    # 1. Setup wizard — create the admin account (real browser form).
    page.goto(f"{frontend_url}/setup")
    page.fill("#username", ADMIN_USER)
    page.fill("#password", ADMIN_PASS)
    page.fill("#confirm", ADMIN_PASS)
    page.click("button[type=submit]")
    page.wait_for_url("**/login", timeout=30_000)

    # 2. Log in → the admin lands on the galleries dashboard (cookie now set on this context).
    page.fill("#username", ADMIN_USER)
    page.fill("#password", ADMIN_PASS)
    page.click("button[type=submit]")
    page.wait_for_url("**/admin/galleries", timeout=30_000)

    api = page.request  # carries the admin cookie; routed through Next → backend

    # 3. Create a gallery (collaboration mode so client comments are allowed).
    r = api.post(
        f"{frontend_url}/api/galleries",
        data={"name": "E2E Wedding", "mode": "collaboration", "downloads_enabled": True},
    )
    assert r.ok, r.text()
    gallery = r.json()
    gid, share = gallery["id"], gallery["share_token"]

    # 4. Upload a photo.
    r = api.post(
        f"{frontend_url}/api/galleries/{gid}/images",
        multipart={"files": {"name": "shot.png", "mimeType": "image/png", "buffer": _png()}},
    )
    assert r.ok, r.text()
    image_id = r.json()[0]["id"]

    # 5. Wait for async rendition processing → the photo becomes public with a thumbnail.
    thumb_url = None
    for _ in range(60):
        imgs = api.get(f"{frontend_url}/api/public/g/{share}/images").json()
        if imgs and imgs[0].get("thumb_url"):
            thumb_url = imgs[0]["thumb_url"]
            break
        time.sleep(0.5)
    assert thumb_url, "image never finished processing / became publicly visible"

    # 6. The client opens the share link in the browser → the gallery renders (SSR + client fetch).
    page.goto(f"{frontend_url}/g/{share}")
    page.get_by_text("E2E Wedding").first.wait_for(timeout=30_000)

    # 7. The thumbnail actually serves bytes (image pipeline + static serving over the HTTP path).
    img = api.get(f"{frontend_url}{thumb_url}")
    assert img.ok, img.status
    assert img.headers["content-type"].startswith("image/")
    assert len(img.body()) > 0

    # 8. Client feedback: a colour flag and a comment.
    flag = api.post(f"{frontend_url}/api/public/g/{share}/images/{image_id}/flag", data={"flag": "green"})
    assert flag.ok, flag.text()
    comment = api.post(
        f"{frontend_url}/api/public/g/{share}/images/{image_id}/comments",
        data={"author_name": "Happy Client", "text": "Love this one!"},
    )
    assert comment.status == 201, comment.text()

    # 9. Client downloads the whole gallery as a streamed ZIP.
    zip_resp = api.get(f"{frontend_url}/api/public/g/{share}/zip/stream")
    assert zip_resp.ok, zip_resp.status
    assert zip_resp.headers["content-type"].startswith("application/")
    assert len(zip_resp.body()) > 0
