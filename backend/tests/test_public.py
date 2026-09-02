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


# --- Protected galleries never expose the static /uploads mount ---------------

def _auth_token(pub, share_token, password="secret"):
    return pub.post(f"/api/public/g/{share_token}/auth", json={"password": password}).json()["access_token"]


def test_password_gallery_media_goes_through_access_checked_proxy(admin_client):
    """A password only protects the photos if the *files* are gated too: static /uploads URLs are
    served by nginx with no auth and a 30-day cache, so a once-seen link would outlive the gate."""
    g = make_gallery(admin_client, "Locked")
    img_id = _upload(admin_client, g["id"], "a.png").json()[0]["id"]
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret"})
    pub = _pub()
    tok = _auth_token(pub, g["share_token"])

    [img] = pub.get(f"/api/public/g/{g['share_token']}/images", headers={"Authorization": f"Bearer {tok}"}).json()
    proxy = f"/api/public/g/{g['share_token']}/images/{img_id}"
    assert img["thumb_url"] == f"{proxy}/thumb"
    assert img["small_url"] == f"{proxy}/small"
    assert img["medium_url"] == f"{proxy}/medium"
    # Downloads are on, so the original is offered — but through the proxy, never the static path.
    assert img["original_url"] == f"{proxy}/original"
    assert "/uploads/" not in str(img)

    # The proxy re-checks the gallery token on every fetch (`?token=` — <img>/<a> can't set headers).
    assert pub.get(f"{proxy}/thumb").status_code == 401
    assert pub.get(f"{proxy}/original").status_code == 401
    assert pub.get(f"{proxy}/thumb?token={tok}").status_code == 200
    r = pub.get(f"{proxy}/original?token={tok}")
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment")
    assert 'filename="a.png"' in r.headers["content-disposition"]
    assert "private" in r.headers["cache-control"]
    # The gallery's cover follows the same rule.
    hdr = {"Authorization": f"Bearer {tok}"}
    assert pub.get(f"/api/public/g/{g['share_token']}", headers=hdr).json()["cover_image_url"] == f"{proxy}/thumb"


def test_original_proxy_respects_download_gate(admin_client):
    g = make_gallery(admin_client, "Locked")
    img_id = _upload(admin_client, g["id"]).json()[0]["id"]
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "secret", "downloads_enabled": False})
    pub = _pub()
    tok = _auth_token(pub, g["share_token"])
    [img] = pub.get(f"/api/public/g/{g['share_token']}/images", headers={"Authorization": f"Bearer {tok}"}).json()
    assert img["original_url"] is None
    assert pub.get(f"/api/public/g/{g['share_token']}/images/{img_id}/original?token={tok}").status_code == 403


def test_expiring_gallery_media_goes_through_proxy(admin_client):
    """A static URL would keep serving after `expires_at`; the proxy 410s with the gallery."""
    g = make_gallery(admin_client, "Ends soon")
    img_id = _upload(admin_client, g["id"]).json()[0]["id"]
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    admin_client.patch(f"/api/galleries/{g['id']}", json={"expires_at": future})
    pub = _pub()
    [img] = pub.get(f"/api/public/g/{g['share_token']}/images").json()
    proxy = f"/api/public/g/{g['share_token']}/images/{img_id}"
    assert img["thumb_url"] == f"{proxy}/thumb" and img["original_url"] == f"{proxy}/original"
    assert pub.get(f"{proxy}/thumb").status_code == 200
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    admin_client.patch(f"/api/galleries/{g['id']}", json={"expires_at": past})
    assert pub.get(f"{proxy}/thumb").status_code == 410


def test_open_gallery_keeps_static_urls(admin_client):
    """No password / expiry / watermark / download gate → the cheap static mount stays in use."""
    g = make_gallery(admin_client, "Open")
    _upload(admin_client, g["id"])
    [img] = _pub().get(f"/api/public/g/{g['share_token']}/images").json()
    assert img["thumb_url"].startswith("/uploads/") and img["original_url"].startswith("/uploads/")


def test_stream_zip_skips_protected_children(admin_client):
    """The parent's ZIP must not bundle a child the viewer couldn't open on its own: a password-
    protected child, one with downloads off, or an expired one is dropped from the selection."""
    parent = make_gallery(admin_client, "Parent")
    locked = make_gallery(admin_client, "Locked", parent_id=parent["id"])
    nodl = make_gallery(admin_client, "NoDL", parent_id=parent["id"])
    ok = make_gallery(admin_client, "Open", parent_id=parent["id"])
    _upload(admin_client, parent["id"], "root.png")
    _upload(admin_client, locked["id"], "secret.png")
    _upload(admin_client, nodl["id"], "nodl.png")
    _upload(admin_client, ok["id"], "kid.png")
    admin_client.patch(f"/api/galleries/{locked['id']}", json={"password": "secret"})
    admin_client.patch(f"/api/galleries/{nodl['id']}", json={"downloads_enabled": False})
    subs = ",".join([locked["share_token"], nodl["share_token"], ok["share_token"]])
    r = _pub().get(f"/api/public/g/{parent['share_token']}/zip/stream?subs={subs}")
    assert r.status_code == 200
    assert set(zipfile.ZipFile(io.BytesIO(r.content)).namelist()) == {"Parent/root.png", "Open/kid.png"}


def test_zip_job_skips_protected_children(admin_client):
    parent = make_gallery(admin_client, "Parent")
    locked = make_gallery(admin_client, "Locked", parent_id=parent["id"])
    _upload(admin_client, locked["id"], "secret.png")
    admin_client.patch(f"/api/galleries/{locked['id']}", json={"password": "secret"})
    # The parent itself is empty, so with the locked child dropped there is nothing to download.
    r = _pub().post(f"/api/public/g/{parent['share_token']}/zip", json={"subgallery_share_tokens": [locked["share_token"]]})
    assert r.status_code == 400


# --- Metadata is gated server-side --------------------------------------------

def test_exif_and_iptc_hidden_unless_enabled(admin_client, db):
    """EXIF carries GPS — `show_exif` off must strip it from the public payload, not just the UI."""
    import json as _json
    from app.models.image import Image
    g = make_gallery(admin_client, "Meta", mode="collaboration")
    img_id = _upload(admin_client, g["id"]).json()[0]["id"]
    row = db.query(Image).filter(Image.id == img_id).one()
    row.exif_data = _json.dumps({"Make": "Leica", "GPSLatitude": [52, 31, 0]})
    row.iptc_data = _json.dumps({"title": "Home"})
    db.commit()

    [pub_img] = _pub().get(f"/api/public/g/{g['share_token']}/images").json()
    assert pub_img["exif_data"] is None and pub_img["iptc_data"] is None
    # The photographer's own view is never stripped.
    [adm_img] = admin_client.get(f"/api/galleries/{g['id']}/images").json()
    assert adm_img["exif_data"]["Make"] == "Leica" and adm_img["iptc_data"]["title"] == "Home"

    admin_client.patch(f"/api/galleries/{g['id']}", json={"show_exif": True, "show_iptc": True})
    [pub_img] = _pub().get(f"/api/public/g/{g['share_token']}/images").json()
    assert pub_img["exif_data"]["GPSLatitude"] == [52, 31, 0] and pub_img["iptc_data"]["title"] == "Home"
    # The flag echo goes through the same serializer.
    r = _pub().post(f"/api/public/g/{g['share_token']}/images/{img_id}/flag", json={"flag": "green"})
    assert r.status_code == 200 and r.json()["exif_data"]["Make"] == "Leica"
    admin_client.patch(f"/api/galleries/{g['id']}", json={"show_exif": False})
    r = _pub().post(f"/api/public/g/{g['share_token']}/images/{img_id}/flag", json={"flag": "red"})
    assert r.status_code == 200 and r.json()["exif_data"] is None


# --- Gallery tokens are bound to the password they were issued against --------

def test_gallery_token_dies_with_the_password(admin_client):
    g = make_gallery(admin_client, "Locked")
    add_image(g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "first"})
    pub = _pub()
    tok = _auth_token(pub, g["share_token"], "first")
    hdr = {"Authorization": f"Bearer {tok}"}
    assert pub.get(f"/api/public/g/{g['share_token']}/images", headers=hdr).status_code == 200

    # Password changed → the 12 h token issued against the old one is no longer good enough.
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": "second"})
    assert pub.get(f"/api/public/g/{g['share_token']}/images", headers=hdr).status_code == 401
    assert pub.get(f"/api/public/g/{g['share_token']}", headers=hdr).json() == {"requires_password": True}
    tok2 = _auth_token(pub, g["share_token"], "second")
    assert pub.get(f"/api/public/g/{g['share_token']}/images", headers={"Authorization": f"Bearer {tok2}"}).status_code == 200

    # Password removed → open again, with or without a stale token.
    admin_client.patch(f"/api/galleries/{g['id']}", json={"password": ""})
    assert pub.get(f"/api/public/g/{g['share_token']}/images", headers=hdr).status_code == 200
    assert pub.get(f"/api/public/g/{g['share_token']}/images").status_code == 200


# --- review_active is *the* gate for every client write -----------------------

def test_team_votes_and_collections_closed_on_showcase_child(admin_client):
    """`enable_team_voting` / `sets_enabled` cascade to sub-galleries but `mode` never does, so a
    Showcase child of a Review container carries the toggles — the endpoints must still be shut."""
    parent = make_gallery(admin_client, "Review", mode="collaboration",
                          enable_team_voting=True, color_flags_enabled=True, sets_enabled=True)
    child = make_gallery(admin_client, "Showcase", parent_id=parent["id"], mode="presentation")
    admin_client.patch(f"/api/galleries/{parent['id']}",
                       json={"enable_team_voting": True, "sets_enabled": True, "apply_to_subgalleries": True})
    child_now = admin_client.get(f"/api/galleries/{child['id']}").json()
    assert child_now["enable_team_voting"] and child_now["sets_enabled"] and child_now["mode"] == "presentation"
    img = add_image(child["id"])
    pub = _pub()
    r = pub.put(f"/api/public/g/{child['share_token']}/images/{img}/vote", json={"reviewer_name": "Anna", "color_flag": "green"})
    assert r.status_code == 400
    r = pub.post(f"/api/public/g/{child['share_token']}/collections", json={"name": "Picks", "image_ids": [img], "creator": "Anna"})
    assert r.status_code == 403
    # Opening the client mode switch (review_active) opens them.
    admin_client.patch(f"/api/galleries/{child['id']}", json={"client_mode_switch_enabled": True})
    r = pub.put(f"/api/public/g/{child['share_token']}/images/{img}/vote", json={"reviewer_name": "Anna", "color_flag": "green"})
    assert r.status_code == 200


def test_public_collection_cannot_hold_pending_uploads(admin_client):
    g = make_gallery(admin_client, "Sets", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"sets_enabled": True})
    ok = add_image(g["id"])
    pending = add_image(g["id"], moderation_status="pending")
    r = _pub().post(f"/api/public/g/{g['share_token']}/collections",
                    json={"name": "Picks", "image_ids": [pending, ok], "creator": "Anna"})
    assert r.status_code == 201 and r.json()["image_ids"] == [ok]


def test_client_upload_accepts_web_formats_only(admin_client):
    """The anonymous path never reaches the TIFF/PSD/RAW decoders."""
    import io as _io
    from PIL import Image as _PIL
    g = make_gallery(admin_client, "Up", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True})
    buf = _io.BytesIO()
    _PIL.new("RGB", (8, 8)).save(buf, format="TIFF")
    r = _pub().post(f"/api/public/g/{g['share_token']}/images",
                    files=[("files", ("scan.tif", buf.getvalue(), "image/tiff"))], data={"uploader": "Bob"})
    assert r.status_code == 415 and r.json()["code"] == "upload_unsupported_type"
    r = _pub().post(f"/api/public/g/{g['share_token']}/images",
                    files=[("files", ("p.png", png_bytes(), "image/png"))], data={"uploader": "Bob"})
    assert r.status_code == 201
    # The photographer still uploads TIFFs.
    r = admin_client.post(f"/api/galleries/{g['id']}/images", files=[("files", ("scan.tif", buf.getvalue(), "image/tiff"))])
    assert r.status_code == 201


def test_public_zip_download_rechecks_download_gate(admin_client):
    g = make_gallery(admin_client, "Zip")
    _upload(admin_client, g["id"])
    job = _pub().post(f"/api/public/g/{g['share_token']}/zip", json={}).json()
    admin_client.patch(f"/api/galleries/{g['id']}", json={"downloads_enabled": False})
    assert _pub().get(f"/api/public/g/{g['share_token']}/zip/{job['id']}/download").status_code == 403


def test_zip_download_name_survives_non_ascii_gallery_names(admin_client):
    """Starlette encodes headers as latin-1 — a plain `filename="東京.zip"` would 500."""
    g = make_gallery(admin_client, "東京 Café")
    _upload(admin_client, g["id"])
    r = _pub().get(f"/api/public/g/{g['share_token']}/zip/stream")
    assert r.status_code == 200
    cd = r.headers["content-disposition"]
    assert cd.startswith("attachment;") and "filename*=UTF-8''" in cd and "%E6%9D%B1%E4%BA%AC" in cd
