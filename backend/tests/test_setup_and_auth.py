# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Setup wizard + admin authentication / session revocation."""

from app.config import settings

from .conftest import ADMIN_PASSWORD, ADMIN_USERNAME


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert "version" in body


def test_setup_status_starts_incomplete(client):
    assert client.get("/api/setup/status").json()["setup_complete"] is False


def test_complete_setup_then_locked(client):
    r = client.post("/api/setup", json={"username": "boss", "password": "longenough1"})
    assert r.status_code == 201
    assert client.get("/api/setup/status").json()["setup_complete"] is True
    # Second attempt is rejected — setup is a one-time action.
    r2 = client.post("/api/setup", json={"username": "x", "password": "longenough1"})
    assert r2.status_code == 409


def test_setup_password_min_length(client):
    assert client.post("/api/setup", json={"username": "a", "password": "short"}).status_code == 422


def test_login_requires_setup(client):
    r = client.post("/api/auth/login", json={"username": "admin", "password": "whatever", "remember": False})
    assert r.status_code == 403  # setup not complete


def test_login_success_and_me(admin_client):
    assert admin_client.get("/api/auth/me").json()["username"] == ADMIN_USERNAME


def test_login_wrong_password(setup_done):
    r = setup_done.post("/api/auth/login", json={"username": ADMIN_USERNAME, "password": "nope", "remember": False})
    assert r.status_code == 401


def test_login_wrong_username(setup_done):
    r = setup_done.post("/api/auth/login", json={"username": "ghost", "password": ADMIN_PASSWORD, "remember": False})
    assert r.status_code == 401


def test_protected_route_requires_auth(client):
    assert client.get("/api/galleries").status_code == 401


def test_remember_me_sets_long_lived_cookie(setup_done):
    r = setup_done.post(
        "/api/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "remember": True}
    )
    assert r.status_code == 200
    set_cookie = r.headers.get("set-cookie", "")
    assert f"Max-Age={settings.remember_token_ttl}" in set_cookie  # 30-day persistent cookie


def test_no_remember_still_persistent_matching_token(setup_done):
    # Always a persistent cookie (never a bare session cookie) — WebKit drops session cookies
    # unreliably, logging admins out on every visit. Without "remember" the lifetime matches the
    # token's own 24h expiry.
    r = setup_done.post(
        "/api/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "remember": False}
    )
    assert f"Max-Age={settings.access_token_ttl}" in r.headers.get("set-cookie", "")


def test_change_password_flow(admin_client):
    # Wrong current password rejected with a stable code.
    bad = admin_client.post(
        "/api/auth/change-password", json={"current_password": "wrong", "new_password": "anotherpass1"}
    )
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_current_password"

    # Same password rejected.
    same = admin_client.post(
        "/api/auth/change-password", json={"current_password": ADMIN_PASSWORD, "new_password": ADMIN_PASSWORD}
    )
    assert same.status_code == 400 and same.json()["code"] == "password_unchanged"

    ok = admin_client.post(
        "/api/auth/change-password",
        json={"current_password": ADMIN_PASSWORD, "new_password": "brandnewpass1"},
    )
    assert ok.status_code == 200


def test_logout_all_revokes_other_tokens(setup_done):
    # Two independent sessions (separate bearer tokens).
    login = lambda: setup_done.post(  # noqa: E731
        "/api/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD, "remember": False}
    ).json()["access_token"]
    token_a = login()
    token_b = login()
    auth_a = {"Authorization": f"Bearer {token_a}"}
    auth_b = {"Authorization": f"Bearer {token_b}"}

    # Fresh client without the cookie jar so only the bearer header authenticates.
    from fastapi.testclient import TestClient
    from app.main import app

    bare = TestClient(app)
    assert bare.get("/api/galleries", headers=auth_a).status_code == 200
    assert bare.get("/api/galleries", headers=auth_b).status_code == 200

    # Sign out everywhere using session A.
    assert bare.post("/api/auth/logout-all", headers=auth_a).status_code == 200

    # Both previously-issued tokens are now rejected.
    assert bare.get("/api/galleries", headers=auth_a).status_code == 401
    assert bare.get("/api/galleries", headers=auth_b).status_code == 401
