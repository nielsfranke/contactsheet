# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""The public client upload is refused from the headers alone, before the body is spooled
(app/upload_guard.py) — an anonymous request must not be able to stream GBs onto the data volume
just to be told the gallery doesn't exist or doesn't take uploads."""

import pytest
from fastapi.testclient import TestClient

from app import upload_guard
from app.config import settings
from app.main import app

from .helpers import make_gallery, png_bytes


def _post(token: str, headers: dict | None = None, content: bytes | None = None):
    pub = TestClient(app)
    if content is not None:
        return pub.post(f"/api/public/g/{token}/images", content=content, headers=headers or {})
    return pub.post(
        f"/api/public/g/{token}/images",
        files=[("files", ("p.png", png_bytes(), "image/png"))],
        headers=headers or {},
    )


@pytest.fixture
def body_never_read(monkeypatch):
    """Fail the test if the route handler (i.e. the multipart parse) is ever reached."""
    from app.routers import public

    def boom(*a, **k):
        raise AssertionError("handler ran — the body was spooled")

    monkeypatch.setattr(public.image_service, "client_upload_images", boom)


def test_unknown_gallery_refused_before_body(admin_client, body_never_read):
    assert _post("does-not-exist").status_code == 404


def test_upload_disabled_refused_before_body(admin_client, body_never_read):
    g = make_gallery(admin_client, "NoUp")
    r = _post(g["share_token"])
    assert r.status_code == 403 and r.json()["code"] == "client_upload_disabled"


def test_password_gallery_refused_without_token(admin_client, body_never_read):
    g = make_gallery(admin_client, "Locked")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True, "password": "pw"})
    r = _post(g["share_token"])
    assert r.status_code == 401 and r.json()["code"] == "gallery_token_required"


def test_declared_size_over_guest_ceiling_refused(admin_client, body_never_read, monkeypatch):
    g = make_gallery(admin_client, "Up")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True})
    monkeypatch.setattr(settings, "client_upload_max_total_bytes", 0)
    monkeypatch.setattr(upload_guard, "_MULTIPART_SLACK", 10)
    r = _post(g["share_token"])
    assert r.status_code == 413 and r.json()["code"] == "upload_too_large"


def test_free_space_reserve_counts_in_flight_uploads(admin_client, body_never_read, monkeypatch):
    g = make_gallery(admin_client, "Up")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True})
    # Pretend parallel uploads already hold almost all the free space.
    import shutil
    free = shutil.disk_usage(settings.upload_dir).free
    monkeypatch.setattr(upload_guard, "_in_flight", free)
    r = _post(g["share_token"])
    assert r.status_code == 507 and r.json()["code"] == "storage_full"


def test_missing_content_length_refused(admin_client, body_never_read):
    g = make_gallery(admin_client, "Up")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True})

    def chunks():
        yield b"--x\r\n"

    r = _post(g["share_token"], content=chunks(), headers={"content-type": "multipart/form-data; boundary=x"})
    assert r.status_code == 411


def test_allowed_upload_still_works_and_releases_reservation(admin_client):
    g = make_gallery(admin_client, "Up")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True})
    r = _post(g["share_token"])
    assert r.status_code == 201, r.text
    assert upload_guard._in_flight == 0
