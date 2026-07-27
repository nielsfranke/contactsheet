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


def test_lightbox_zoom_settings_roundtrip_and_public(admin_client):
    """Instance lightbox-zoom config (on/off + ceiling) persists and reaches the public payload."""
    s = admin_client.get("/api/admin/settings").json()
    assert s["lightbox_zoom_enabled"] is True
    assert s["lightbox_zoom_max"] == "400"

    r = admin_client.patch(
        "/api/admin/settings",
        json={"lightbox_zoom_enabled": False, "lightbox_zoom_max": "original"},
    )
    assert r.status_code == 200
    s = admin_client.get("/api/admin/settings").json()
    assert s["lightbox_zoom_enabled"] is False
    assert s["lightbox_zoom_max"] == "original"

    g = make_gallery(admin_client, "Zoomy", mode="collaboration")
    pub = admin_client.get(f"/api/public/g/{g['share_token']}").json()
    assert pub["lightbox_zoom_enabled"] is False
    assert pub["lightbox_zoom_max"] == "original"

    # Only the known ceilings are accepted.
    assert admin_client.patch("/api/admin/settings", json={"lightbox_zoom_max": "150"}).status_code == 422


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


def test_client_mode_switch_opens_review_endpoints(admin_client):
    """Showcase + client mode switch: the review write endpoints accept requests."""
    g = make_gallery(admin_client, "Show", mode="presentation")
    admin_client.patch(
        f"/api/galleries/{g['id']}", json={"client_mode_switch_enabled": True, "likes_enabled": True}
    )
    img = add_image(g["id"])
    t = g["share_token"]
    assert admin_client.post(f"/api/public/g/{t}/images/{img}/flag", json={"flag": "green"}).status_code == 200
    assert admin_client.post(f"/api/public/g/{t}/images/{img}/rate", json={"rating": 4}).status_code == 200
    assert admin_client.post(f"/api/public/g/{t}/images/{img}/like", json={"reviewer": "Bob"}).status_code == 200
    r = admin_client.post(
        f"/api/public/g/{t}/images/{img}/comments", json={"author_name": "Bob", "text": "nice"}
    )
    assert r.status_code == 201


def test_client_mode_switch_public_field_and_inheritance(admin_client):
    g = make_gallery(admin_client, "Show", mode="presentation")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_mode_switch_enabled": True})
    pub = admin_client.get(f"/api/public/g/{g['share_token']}").json()
    assert pub["client_mode_switch_enabled"] is True
    # New sub-galleries copy the parent's setting.
    sub = make_gallery(admin_client, "Sub", parent_id=g["id"])
    assert sub["client_mode_switch_enabled"] is True


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


# --- cover URLs must respect the same protection as the image variants -------------------------


def test_protected_gallery_cover_routes_through_proxy(admin_client):
    """Regression: with downloads disabled (or watermark on) the photo-derived cover leaked the
    static /uploads URL, from which the un-watermarked original path could be derived."""
    g = make_gallery(admin_client, "NoDl", mode="presentation")
    _upload(admin_client, g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"downloads_enabled": False})

    r = admin_client.get(f"/api/public/g/{g['share_token']}")
    assert r.status_code == 200
    cover = r.json()["cover_image_url"]
    assert cover is not None
    assert cover.startswith(f"/api/public/g/{g['share_token']}/images/")
    assert "/uploads/" not in cover


def test_subgallery_covers_proxied_and_password_children_hidden(admin_client):
    parent = make_gallery(admin_client, "Parent")
    protected = make_gallery(admin_client, "Protected", parent_id=parent["id"])
    _upload(admin_client, protected["id"])
    admin_client.patch(f"/api/galleries/{protected['id']}", json={"downloads_enabled": False})
    locked = make_gallery(admin_client, "Locked", parent_id=parent["id"])
    _upload(admin_client, locked["id"])
    admin_client.patch(f"/api/galleries/{locked['id']}", json={"password": "secret"})

    r = admin_client.get(f"/api/public/g/{parent['share_token']}")
    assert r.status_code == 200
    subs = {s["name"]: s for s in r.json()["subgalleries"]}
    # Protected child's card cover goes through its own access-checked proxy.
    assert subs["Protected"]["cover_image_url"].startswith(
        f"/api/public/g/{protected['share_token']}/images/"
    )
    # A password-protected child keeps its cover behind the gate (same policy as the OG image).
    assert subs["Locked"]["cover_image_url"] is None


def test_pending_upload_never_becomes_public_cover(admin_client):
    g = make_gallery(admin_client, "Mod", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_moderation": True})
    add_image(g["id"], moderation_status="pending", sort_order=0)

    r = admin_client.get(f"/api/public/g/{g['share_token']}")
    assert r.status_code == 200
    assert r.json()["cover_image_url"] is None

    # An approved photo (even sorted after the pending one) becomes the cover instead.
    add_image(g["id"], moderation_status="approved", sort_order=1)
    r = admin_client.get(f"/api/public/g/{g['share_token']}")
    assert r.json()["cover_image_url"] is not None


def test_variant_proxy_accepts_query_token(admin_client):
    """<img> tags can't send an Authorization header — the proxy must accept ?token= (like the
    zip stream), or password-protected galleries with watermark/downloads-off render no images."""
    g = make_gallery(admin_client, "Locked", mode="presentation")
    _upload(admin_client, g["id"])
    admin_client.patch(
        f"/api/galleries/{g['id']}", json={"password": "secret", "downloads_enabled": False}
    )

    from fastapi.testclient import TestClient
    from app.main import app
    pub = TestClient(app)
    token = pub.post(
        f"/api/public/g/{g['share_token']}/auth", json={"password": "secret"}
    ).json()["access_token"]

    imgs = pub.get(
        f"/api/public/g/{g['share_token']}/images", headers={"Authorization": f"Bearer {token}"}
    ).json()
    thumb_url = imgs[0]["thumb_url"]
    assert thumb_url.startswith("/api/public/")

    assert pub.get(thumb_url).status_code == 401
    assert pub.get(f"{thumb_url}?token={token}").status_code == 200


def test_expired_children_hidden_from_public_nav(admin_client):
    parent = make_gallery(admin_client, "Parent")
    make_gallery(admin_client, "Live", parent_id=parent["id"])
    dead = make_gallery(admin_client, "Dead", parent_id=parent["id"])
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    admin_client.patch(f"/api/galleries/{dead['id']}", json={"expires_at": past})

    r = admin_client.get(f"/api/public/g/{parent['share_token']}")
    assert r.status_code == 200
    assert [s["name"] for s in r.json()["subgalleries"]] == ["Live"]


def test_gallery_token_not_valid_for_other_gallery(admin_client):
    """A gallery JWT authorizes exactly the gallery it was issued for. Presenting gallery A's
    token to password-protected gallery B must 401 on every carrier: the Authorization header
    (REST) and the ?token= query variants (zip stream + image serving proxy, which live in
    URLs and can't carry a header)."""
    a = make_gallery(admin_client, "LockedA")
    b = make_gallery(admin_client, "LockedB")
    img_b = _upload(admin_client, b["id"], "b.png").json()[0]["id"]
    for g in (a, b):
        admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    pub = _pub()
    tok_a = pub.post(
        f"/api/public/g/{a['share_token']}/auth", json={"password": "secret"}
    ).json()["access_token"]

    hdr_a = {"Authorization": f"Bearer {tok_a}"}
    assert pub.get(f"/api/public/g/{b['share_token']}", headers=hdr_a).json() == {"requires_password": True}
    assert pub.get(f"/api/public/g/{b['share_token']}/images", headers=hdr_a).status_code == 401
    assert pub.get(f"/api/public/g/{b['share_token']}/zip/stream", params={"token": tok_a}).status_code == 401
    assert (
        pub.get(f"/api/public/g/{b['share_token']}/images/{img_b}/thumb", params={"token": tok_a}).status_code
        == 401
    )

    # Control: B's own token passes the same gates.
    tok_b = pub.post(
        f"/api/public/g/{b['share_token']}/auth", json={"password": "secret"}
    ).json()["access_token"]
    assert pub.get(
        f"/api/public/g/{b['share_token']}/images", headers={"Authorization": f"Bearer {tok_b}"}
    ).status_code == 200
    assert pub.get(f"/api/public/g/{b['share_token']}/zip/stream", params={"token": tok_b}).status_code == 200
