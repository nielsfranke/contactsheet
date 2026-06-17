# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Public gallery access: password gate, expiration, moderation hiding, collaboration gating."""

from datetime import datetime, timedelta, timezone

from .helpers import make_gallery, add_image


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
