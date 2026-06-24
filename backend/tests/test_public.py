# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Public gallery access: password gate, expiration, moderation hiding, collaboration gating."""

import io
import zipfile
from datetime import datetime, timedelta, timezone

from .helpers import make_gallery, add_image, png_bytes


def _upload(admin_client, gallery_id, name="p.png"):
    return admin_client.post(
        f"/api/galleries/{gallery_id}/images",
        files=[("files", (name, png_bytes(), "image/png"))],
    )


def test_public_gallery_visible_without_password(admin_client):
    g = make_gallery(admin_client, "Open", mode="presentation")
    r = admin_client.get(f"/api/public/g/{g['share_token']}")
    assert r.status_code == 200 and r.json()["name"] == "Open"


def test_public_gallery_unknown_token_404(admin_client):
    assert admin_client.get("/api/public/g/nope").status_code == 404


def test_password_gate_hides_gallery(admin_client):
    g = make_gallery(admin_client, "Locked")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    # A fresh public client (no admin cookie) only sees the requires_password stub.
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    r = pub.get(f"/api/public/g/{g['share_token']}")
    assert r.status_code == 200 and r.json() == {"requires_password": True}


def test_password_auth_returns_token(admin_client):
    g = make_gallery(admin_client, "Locked")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    assert pub.post(f"/api/public/g/{g['share_token']}/auth", json={"password": "wrong"}).status_code == 401
    ok = pub.post(f"/api/public/g/{g['share_token']}/auth", json={"password": "secret"})
    assert ok.status_code == 200
    token = ok.json()["access_token"]
    # The token unlocks the image listing.
    imgs = pub.get(
        f"/api/public/g/{g['share_token']}/images", headers={"Authorization": f"Bearer {token}"}
    )
    assert imgs.status_code == 200


def test_password_protected_images_blocked_without_token(admin_client):
    g = make_gallery(admin_client, "Locked")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    assert pub.get(f"/api/public/g/{g['share_token']}/images").status_code == 401


def test_expired_gallery_returns_410(admin_client):
    g = make_gallery(admin_client, "Expired")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    admin_client.patch(f"/api/galleries/{g['id']}", json={"expires_at": past})
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    r = pub.get(f"/api/public/g/{g['share_token']}")
    assert r.status_code == 410 and r.json()["code"] == "gallery_expired"


# --- Link-preview metadata (Open Graph) -------------------------------------

def _jpeg(size=(64, 48), color=(200, 120, 40)) -> bytes:
    from PIL import Image as PilImage
    buf = io.BytesIO()
    PilImage.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def _set_header(admin_client, gallery_id, size=(64, 48)):
    r = admin_client.post(
        f"/api/galleries/{gallery_id}/header-image",
        files={"file": ("h.jpg", _jpeg(size), "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_meta_image_url_points_to_og_endpoint(admin_client):
    g = make_gallery(admin_client, "Wedding", mode="presentation")
    _set_header(admin_client, g["id"])
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    r = pub.get(f"/api/public/g/{g['share_token']}/meta")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Wedding"
    assert body["password_protected"] is False
    # The og:image is the bounded endpoint, not the raw header/medium file.
    assert body["image_url"] and body["image_url"].endswith(f"/api/public/g/{g['share_token']}/og-image")


def test_meta_image_url_none_without_preview_source(admin_client):
    # A gallery with only a DB-inserted image (no rendition on disk) has no controlled preview.
    g = make_gallery(admin_client, "Bare", mode="presentation")
    add_image(g["id"])
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    body = pub.get(f"/api/public/g/{g['share_token']}/meta").json()
    assert body["image_url"] is None


def test_header_upload_over_1mb_is_accepted_and_bounded(admin_client):
    # nginx caps body size in prod; the backend itself must accept >1 MB and store it bounded.
    from PIL import Image as PilImage
    import os as _os
    from app.config import settings as cfg
    g = make_gallery(admin_client, "Big")
    res = _set_header(admin_client, g["id"], size=(5000, 3333))
    fn = res["header_image_url"].rsplit("/", 1)[-1]
    assert fn.endswith(".jpg")
    path = _os.path.join(cfg.branding_dir, "gallery-headers", g["id"], fn)
    with PilImage.open(path) as im:
        assert max(im.size) <= cfg.header_max_px        # downscaled to the 3840 cap
        assert im.format == "JPEG"
        assert "exif" not in im.info                     # EXIF stripped on re-encode


def test_og_image_is_small_jpeg(admin_client):
    from PIL import Image as PilImage
    g = make_gallery(admin_client, "Preview")
    _set_header(admin_client, g["id"], size=(5000, 3333))
    from fastapi.testclient import TestClient
    from app.main import app
    from app.config import settings as cfg
    pub = TestClient(app)
    r = pub.get(f"/api/public/g/{g['share_token']}/og-image")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    with PilImage.open(io.BytesIO(r.content)) as im:
        assert max(im.size) <= cfg.og_image_max_px       # ≤ 1200, well under WhatsApp's cap


def test_og_image_etag_conditional_304(admin_client):
    g = make_gallery(admin_client, "Etag")
    _set_header(admin_client, g["id"])
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    r1 = pub.get(f"/api/public/g/{g['share_token']}/og-image")
    etag = r1.headers["etag"]
    assert etag
    r2 = pub.get(f"/api/public/g/{g['share_token']}/og-image", headers={"If-None-Match": etag})
    assert r2.status_code == 304


def test_og_image_404_for_password_and_unknown(admin_client):
    g = make_gallery(admin_client, "Locked")
    _set_header(admin_client, g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    assert pub.get(f"/api/public/g/{g['share_token']}/og-image").status_code == 404
    assert pub.get("/api/public/g/nope/og-image").status_code == 404


def test_meta_password_protected_hides_image(admin_client):
    g = make_gallery(admin_client, "Locked")
    add_image(g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    r = pub.get(f"/api/public/g/{g['share_token']}/meta")
    assert r.status_code == 200
    body = r.json()
    # The name isn't secret (the password gate shows it), but the cover sits behind the gate.
    assert body["name"] == "Locked"
    assert body["password_protected"] is True
    assert body["image_url"] is None


def test_meta_expired_returns_404(admin_client):
    g = make_gallery(admin_client, "Gone")
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    admin_client.patch(f"/api/galleries/{g['id']}", json={"expires_at": past})
    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    assert pub.get(f"/api/public/g/{g['share_token']}/meta").status_code == 404


def test_meta_unknown_token_404(admin_client):
    assert admin_client.get("/api/public/g/nope/meta").status_code == 404


def test_meta_is_side_effect_free(admin_client, db):
    """A scraper unfurling the link must not enqueue a view notification or log a view — unlike the
    full gallery endpoint."""
    from app.repositories import notification_repo

    # Enable notifications with the (default-off) "view" event on, so a view *would* be queued.
    admin_client.patch("/api/admin/settings", json={
        "notifications": {
            "enabled": True,
            "events": {"view": True},
            "channels": [{"id": "c1", "type": "custom", "url": "json://localhost", "enabled": True}],
        },
    })
    g = make_gallery(admin_client, "Spy", mode="presentation")

    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)

    # /meta must not touch the outbox...
    pub.get(f"/api/public/g/{g['share_token']}/meta")
    assert notification_repo.list_pending(db) == []

    # ...whereas opening the full gallery does (proves the setup would have produced one).
    pub.get(f"/api/public/g/{g['share_token']}")
    assert any(r.event_type == "view" for r in notification_repo.list_pending(db))


def test_pending_moderated_uploads_hidden_from_public(admin_client):
    g = make_gallery(admin_client, "Mod", mode="collaboration")
    add_image(g["id"], moderation_status="approved")
    add_image(g["id"], moderation_status="pending")
    # Public list + count only sees the approved one.
    pub = admin_client.get(f"/api/public/g/{g['share_token']}")
    assert pub.json()["image_count"] == 1
    imgs = admin_client.get(f"/api/public/g/{g['share_token']}/images")
    assert len(imgs.json()) == 1
    # Admin list sees both.
    assert len(admin_client.get(f"/api/galleries/{g['id']}/images").json()) == 2


def test_comments_blocked_in_presentation_mode(admin_client):
    g = make_gallery(admin_client, "Show", mode="presentation")
    img = add_image(g["id"])
    r = admin_client.post(
        f"/api/public/g/{g['share_token']}/images/{img}/comments",
        json={"author_name": "Bob", "text": "nice"},
    )
    assert r.status_code == 400  # not in collaboration mode


def test_flag_requires_collaboration_mode(admin_client):
    g = make_gallery(admin_client, "Show", mode="presentation")
    img = add_image(g["id"])
    r = admin_client.post(
        f"/api/public/g/{g['share_token']}/images/{img}/flag", json={"flag": "green"}
    )
    assert r.status_code == 400


def test_annotation_requires_toggle(admin_client):
    g = make_gallery(admin_client, "Collab", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"annotations_enabled": False})
    img = add_image(g["id"])
    r = admin_client.post(
        f"/api/public/g/{g['share_token']}/images/{img}/comments",
        json={
            "author_name": "Bob",
            "text": "look here",
            "anchor": {"type": "freehand", "points": [{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}]},
        },
    )
    assert r.status_code == 403 and r.json()["code"] == "annotations_disabled"


# --- Streaming ZIP download -------------------------------------------------

def _pub():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def test_stream_zip_whole_gallery(admin_client):
    g = make_gallery(admin_client, "Stream")
    _upload(admin_client, g["id"], "a.png")
    _upload(admin_client, g["id"], "b.png")
    r = _pub().get(f"/api/public/g/{g['share_token']}/zip/stream")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    # Content-Length is exact — what gives the browser a real progress bar.
    assert int(r.headers["content-length"]) == len(r.content)
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert z.testzip() is None
    assert sorted(z.namelist()) == ["a.png", "b.png"]
    assert {i.compress_type for i in z.infolist()} == {zipfile.ZIP_STORED}


def test_stream_zip_subgalleries_use_folders(admin_client):
    parent = make_gallery(admin_client, "Parent")
    child = make_gallery(admin_client, "Child", parent_id=parent["id"])
    _upload(admin_client, parent["id"], "root.png")
    _upload(admin_client, child["id"], "kid.png")
    r = _pub().get(f"/api/public/g/{parent['share_token']}/zip/stream?subs={child['share_token']}")
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert set(z.namelist()) == {"Parent/root.png", "Child/kid.png"}


def test_stream_zip_filtered_selection(admin_client):
    g = make_gallery(admin_client, "Sel")
    a = _upload(admin_client, g["id"], "a.png").json()[0]["id"]
    _upload(admin_client, g["id"], "b.png")
    r = _pub().get(f"/api/public/g/{g['share_token']}/zip/stream?images={a}")
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert z.namelist() == ["a.png"]


def test_stream_zip_password_requires_token(admin_client):
    g = make_gallery(admin_client, "Locked")
    _upload(admin_client, g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    pub = _pub()
    assert pub.get(f"/api/public/g/{g['share_token']}/zip/stream").status_code == 401
    tok = pub.post(f"/api/public/g/{g['share_token']}/auth", json={"password": "secret"}).json()["access_token"]
    assert pub.get(f"/api/public/g/{g['share_token']}/zip/stream?token={tok}").status_code == 200


def test_stream_zip_excludes_pending_moderation(admin_client, db):
    from app.models.image import Image
    g = make_gallery(admin_client, "Mod")
    _upload(admin_client, g["id"], "ok.png")
    _upload(admin_client, g["id"], "pending.png")
    for im in db.query(Image).filter(Image.gallery_id == g["id"]).all():
        if im.original_filename == "pending.png":
            im.moderation_status = "pending"
    db.commit()
    r = _pub().get(f"/api/public/g/{g['share_token']}/zip/stream")
    assert r.status_code == 200
    assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() == ["ok.png"]


def test_stream_zip_blocked_when_downloads_disabled(admin_client):
    g = make_gallery(admin_client, "NoDl")
    _upload(admin_client, g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"downloads_enabled": False})
    assert _pub().get(f"/api/public/g/{g['share_token']}/zip/stream").status_code == 403


def test_stream_zip_fires_download_notification(admin_client, db):
    """Option B must still notify downloads (skipping the photographer's own — here the public
    client has no admin cookie, so the download is a client one)."""
    from app.repositories import notification_repo
    admin_client.patch("/api/admin/settings", json={
        "notifications": {
            "enabled": True,
            "events": {"download": True},
            "channels": [{"id": "c1", "type": "custom", "url": "json://localhost", "enabled": True}],
        },
    })
    g = make_gallery(admin_client, "Notif")
    _upload(admin_client, g["id"])
    _pub().get(f"/api/public/g/{g['share_token']}/zip/stream")
    assert any(r.event_type == "download" for r in notification_repo.list_pending(db))
