# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Regression tests for the hardening pass (audit findings #2–#6).

#2 cookie Secure auto-upgrade via X-Forwarded-Proto
#3 atomic first-run setup claim (no land-grab race)
#4 SVG logo upload rejected
#5 magic-byte validation on branding/header/cover/watermark uploads
#6 expired gallery rejects its public WebSocket
"""

from fastapi.testclient import TestClient

from app.main import app

from .helpers import big_jpeg_bytes, make_gallery, png_bytes


# --- #2: cookie Secure follows X-Forwarded-Proto ---------------------------------------------

def test_login_cookie_not_secure_over_plain_http(setup_done):
    r = setup_done.post(
        "/api/auth/login",
        json={"username": "admin", "password": "supersecret123", "remember": False},
    )
    assert r.status_code == 200
    assert "secure" not in r.headers.get("set-cookie", "").lower()


def test_login_cookie_secure_when_forwarded_https(setup_done):
    r = setup_done.post(
        "/api/auth/login",
        json={"username": "admin", "password": "supersecret123", "remember": False},
        headers={"X-Forwarded-Proto": "https"},
    )
    assert r.status_code == 200
    assert "secure" in r.headers.get("set-cookie", "").lower()


# --- #3: setup can only be claimed once ------------------------------------------------------

def test_setup_claimed_once(client):
    first = client.post("/api/setup", json={"username": "admin", "password": "supersecret123"})
    assert first.status_code == 201
    # A second attempt (the land-grab) is rejected, and the original credentials still stand.
    second = client.post("/api/setup", json={"username": "attacker", "password": "attacker-pw-1"})
    assert second.status_code == 409
    ok = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "supersecret123", "remember": False},
    )
    assert ok.status_code == 200


# --- #4: SVG logo rejected -------------------------------------------------------------------

def test_svg_logo_rejected(admin_client):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    r = admin_client.post(
        "/api/admin/settings/logo",
        files=[("file", ("logo.svg", svg, "image/svg+xml"))],
    )
    assert r.status_code == 415


def test_png_logo_accepted(admin_client):
    r = admin_client.post(
        "/api/admin/settings/logo",
        files=[("file", ("logo.png", png_bytes(), "image/png"))],
    )
    assert r.status_code == 200


# --- #5: magic-byte validation on admin image uploads ----------------------------------------

def test_header_image_content_type_spoof_rejected(admin_client):
    g = make_gallery(admin_client, "G")
    # Declares PNG but the bytes are not a PNG (e.g. an HTML/script payload with a .png name).
    r = admin_client.post(
        f"/api/galleries/{g['id']}/header-image",
        files=[("file", ("x.png", b"<html><script>alert(1)</script></html>", "image/png"))],
    )
    assert r.status_code == 415


def test_cover_image_real_png_accepted(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/cover-image",
        files=[("file", ("c.png", png_bytes(), "image/png"))],
    )
    assert r.status_code == 200


def test_header_image_over_10mb_accepted(admin_client):
    """Header/cover uploads use their own 100 MB cap, not the generic 10 MB read_limited default —
    photographers drop full-res developed JPEGs and the server bounds them to 3840 px on store."""
    g = make_gallery(admin_client, "G")
    big = big_jpeg_bytes()  # ~35 MB, comfortably past the old 10 MB ceiling
    assert len(big) > 10 * 1024 * 1024
    r = admin_client.post(
        f"/api/galleries/{g['id']}/header-image",
        files=[("file", ("big.jpg", big, "image/jpeg"))],
    )
    assert r.status_code == 200, r.text


def test_watermark_content_type_spoof_rejected(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/watermark",
        files=[("file", ("wm.png", b"not really a png", "image/png"))],
    )
    assert r.status_code == 415


# --- #6: expired gallery rejects its public websocket ----------------------------------------

def test_expired_gallery_ws_rejected(admin_client):
    from datetime import datetime, timedelta, timezone

    from starlette.websockets import WebSocketDisconnect

    g = make_gallery(admin_client, "Expiring", mode="presentation")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    admin_client.patch(f"/api/galleries/{g['id']}", json={"expires_at": past})

    pub = TestClient(app)
    # The handler accepts then closes with the application "gone" code (4410); the test client
    # surfaces that as a WebSocketDisconnect on the first receive.
    with pub.websocket_connect(f"/api/ws/public/g/{g['share_token']}") as ws:
        try:
            ws.receive_text()
            closed_code = None
        except WebSocketDisconnect as exc:
            closed_code = exc.code
    assert closed_code == 4410

    # A live, non-expired gallery's socket stays open.
    g2 = make_gallery(admin_client, "Live", mode="presentation")
    with pub.websocket_connect(f"/api/ws/public/g/{g2['share_token']}"):
        pass


# --- #7: stricter pixel ceiling for client (public) uploads ----------------------------------

def _seed_original(gallery_id: str, *, uploaded_by) -> str:
    """Insert an image row + write a real 16x16 (256px) PNG at its original path. Returns id."""
    import os
    import uuid

    from app.config import settings
    from app.database import SessionLocal
    from app.repositories import image_repo

    stored = f"{uuid.uuid4()}.png"
    original_dir = os.path.join(settings.upload_dir, gallery_id, "original")
    os.makedirs(original_dir, exist_ok=True)
    with open(os.path.join(original_dir, stored), "wb") as f:
        f.write(png_bytes(size=(16, 16)))
    db = SessionLocal()
    try:
        img = image_repo.create(
            db,
            id=str(uuid.uuid4()),
            gallery_id=gallery_id,
            original_filename="p.png",
            stored_filename=stored,
            file_size=256,
            mime_type="image/png",
            sort_order=0,
            processing_status="pending",
            moderation_status="approved",
            uploaded_by=uploaded_by,
        )
        return img.id, stored
    finally:
        db.close()


def test_client_upload_pixel_cap_enforced(admin_client, monkeypatch):
    from app.config import settings
    from app.database import SessionLocal
    from app.repositories import image_repo
    from app.tasks.image_processing import process_image

    monkeypatch.setattr(settings, "client_upload_max_pixels", 10)  # 16x16=256px > 10 → rejected
    g = make_gallery(admin_client, "G")

    client_id, client_sf = _seed_original(g["id"], uploaded_by="Guest")
    process_image(client_id, g["id"], client_sf)

    admin_id, admin_sf = _seed_original(g["id"], uploaded_by=None)
    process_image(admin_id, g["id"], admin_sf)

    db = SessionLocal()
    try:
        # Client upload is over the (tightened) public cap → marked error.
        assert image_repo.get_by_id(db, client_id).processing_status == "error"
        # Admin upload uses the generous admin ceiling → processed fine.
        assert image_repo.get_by_id(db, admin_id).processing_status == "done"
    finally:
        db.close()
