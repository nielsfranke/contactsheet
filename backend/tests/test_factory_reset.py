# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Factory reset safety: password gate, full purge, settings reset, session invalidation."""

import os

from app.config import settings as app_settings
from app.database import SessionLocal
from app.repositories import gallery_repo, settings_repo

from .conftest import ADMIN_PASSWORD
from .helpers import make_gallery, add_image


def test_reset_requires_correct_password(admin_client):
    g = make_gallery(admin_client, "Keep")
    r = admin_client.post("/api/admin/settings/reset", json={"password": "wrong"})
    assert r.status_code == 400 and r.json()["code"] == "invalid_current_password"
    # Nothing was deleted.
    assert admin_client.get(f"/api/galleries/{g['id']}").status_code == 200


def test_reset_purges_data_and_media(admin_client):
    g = make_gallery(admin_client, "Doomed")
    add_image(g["id"])
    # Drop a stray file into the upload root to confirm media is wiped.
    marker = os.path.join(app_settings.upload_dir, g["id"])
    os.makedirs(marker, exist_ok=True)
    with open(os.path.join(marker, "marker.txt"), "w") as f:
        f.write("x")

    assert admin_client.post("/api/admin/settings/reset", json={"password": ADMIN_PASSWORD}).status_code == 200

    db = SessionLocal()
    try:
        # All galleries hard-purged (not just soft-deleted).
        assert gallery_repo.get_all_active(db) == []
        from app.models.gallery import Gallery
        assert db.query(Gallery).count() == 0
        # Settings singleton recreated in a fresh-install state.
        s = settings_repo.get(db)
        assert s.setup_complete is False
        assert s.admin_password_hash is None and s.admin_username is None
    finally:
        db.close()

    # Media root still exists (static mounts stay valid) but its contents are gone.
    assert os.path.isdir(app_settings.upload_dir)
    assert not os.path.exists(marker)


def test_reset_logs_out_acting_admin(admin_client):
    """Rotating the secret key invalidates the acting admin's token — the next call is 401."""
    assert admin_client.post("/api/admin/settings/reset", json={"password": ADMIN_PASSWORD}).status_code == 200
    # The cookie the client still holds was signed with the old (now-rotated) key.
    assert admin_client.get("/api/galleries").status_code == 401
    # The instance is back to needing setup.
    assert admin_client.get("/api/setup/status").json()["setup_complete"] is False


def test_reset_preserves_directory_roots(admin_client):
    add_image(make_gallery(admin_client, "G")["id"])
    admin_client.post("/api/admin/settings/reset", json={"password": ADMIN_PASSWORD})
    for root in (
        app_settings.upload_dir,
        app_settings.exports_dir,
        app_settings.branding_dir,
        app_settings.watermarks_dir,
    ):
        assert os.path.isdir(root)
