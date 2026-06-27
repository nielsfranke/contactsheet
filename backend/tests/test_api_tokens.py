# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""API tokens (personal access tokens) for third-party clients — e.g. the Capture One export plugin.

Covers issuance/listing/revocation, the scope gate on the plugin-facing endpoints (gallery
read/write, image upload), and the hard boundary that a token can never reach admin-only endpoints
(settings, token management). Tokens travel as `Authorization: Bearer cs_pat_…` on a cookie-less
client, so the admin and token auth paths are exercised independently."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app

from .helpers import png_bytes

ALL_SCOPES = ["galleries:read", "galleries:write", "images:write"]


def _mint(admin_client, scopes, name="capture-one", expires_at=None):
    body = {"name": name, "scopes": scopes}
    if expires_at is not None:
        body["expires_at"] = expires_at
    return admin_client.post("/api/admin/api-tokens", json=body)


def _pat_client(token: str) -> TestClient:
    """A fresh client with no admin cookie — only the bearer token."""
    c = TestClient(app)
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


def test_create_returns_secret_once_then_listed_without_it(admin_client):
    r = _mint(admin_client, ALL_SCOPES)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"].startswith("cs_pat_")
    assert body["prefix"] == body["token"][:12]
    assert sorted(body["scopes"]) == sorted(ALL_SCOPES)

    listed = admin_client.get("/api/admin/api-tokens").json()
    assert len(listed) == 1
    assert "token" not in listed[0]  # secret never returned again
    assert listed[0]["prefix"] == body["prefix"]
    assert listed[0]["last_used_at"] is None


def test_token_can_create_gallery_and_upload(admin_client):
    token = _mint(admin_client, ALL_SCOPES).json()["token"]
    pat = _pat_client(token)

    g = pat.post("/api/galleries", json={"name": "From Capture One", "mode": "presentation"})
    assert g.status_code == 201, g.text
    gid = g.json()["id"]

    up = pat.post(f"/api/galleries/{gid}/images", files=[("files", ("shot.png", png_bytes(), "image/png"))])
    assert up.status_code == 201, up.text

    lst = pat.get("/api/galleries")
    assert lst.status_code == 200
    assert any(x["id"] == gid for x in lst.json())

    # Using the token recorded last_used_at.
    assert admin_client.get("/api/admin/api-tokens").json()[0]["last_used_at"] is not None


def test_scope_is_enforced(admin_client):
    token = _mint(admin_client, ["galleries:read"]).json()["token"]
    pat = _pat_client(token)
    assert pat.get("/api/galleries").status_code == 200  # has read
    assert pat.post("/api/galleries", json={"name": "x", "mode": "presentation"}).status_code == 403  # no write
    assert pat.post(
        "/api/galleries/whatever/images", files=[("files", ("a.png", png_bytes(), "image/png"))]
    ).status_code == 403  # no images:write


def test_token_cannot_reach_admin_only_endpoints(admin_client):
    token = _mint(admin_client, ALL_SCOPES).json()["token"]
    pat = _pat_client(token)
    # Admin identity, token management and settings are cookie-admin only → a PAT just 401s.
    assert pat.get("/api/auth/me").status_code == 401
    assert pat.get("/api/admin/api-tokens").status_code == 401
    assert pat.post("/api/admin/api-tokens", json={"name": "evil", "scopes": ["images:write"]}).status_code == 401


def test_invalid_token_rejected(admin_client):
    assert _pat_client("cs_pat_bogusbogusbogus").get("/api/galleries").status_code == 401


def test_revoked_token_rejected(admin_client):
    created = _mint(admin_client, ALL_SCOPES).json()
    pat = _pat_client(created["token"])
    assert pat.get("/api/galleries").status_code == 200
    assert admin_client.delete(f"/api/admin/api-tokens/{created['id']}").status_code == 204
    assert pat.get("/api/galleries").status_code == 401  # gone after revoke


def test_expired_token_rejected(admin_client):
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    token = _mint(admin_client, ALL_SCOPES, expires_at=past).json()["token"]
    assert _pat_client(token).get("/api/galleries").status_code == 401


def test_unknown_scope_rejected(admin_client):
    assert _mint(admin_client, ["galleries:read", "settings:write"]).status_code == 422


def test_revoke_missing_token_404(admin_client):
    assert admin_client.delete("/api/admin/api-tokens/nonexistent").status_code == 404


def test_admin_cookie_still_authorizes_gated_endpoints(admin_client):
    # The scope gate must not break the normal cookie-admin path.
    assert admin_client.get("/api/galleries").status_code == 200
    assert admin_client.post("/api/galleries", json={"name": "Web", "mode": "presentation"}).status_code == 201


def test_unauthenticated_rejected(client):
    assert client.get("/api/galleries").status_code == 401
    assert client.get("/api/admin/api-tokens").status_code == 401
