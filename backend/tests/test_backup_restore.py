# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Backup & restore (build runs synchronously under TestClient's background tasks).

The suite's DB is built with ``create_all`` (no alembic stamp), so backups taken
without stamping carry ``alembic_revision = None`` and are correctly refused on
restore. Tests that exercise a successful restore stamp the revision first and
no-op the forward migration (the snapshot is already at head). The full
alembic-bootstrapped roundtrip is covered out-of-band; here we pin the endpoint
surface + guardrails."""

import io
import json
import tarfile

from fastapi.testclient import TestClient

from app.main import app
from .conftest import ADMIN_PASSWORD
from .helpers import make_gallery, png_bytes

BACKUP = "/api/admin/settings/backup"
RESTORE = "/api/admin/settings/restore"


def _upload(admin_client, gallery_id):
    return admin_client.post(
        f"/api/galleries/{gallery_id}/images",
        files=[("files", ("p.png", png_bytes(), "image/png"))],
    )


def _stamp_revision(rev="0040"):
    """Give the create_all test DB an alembic stamp so backups carry a known revision."""
    from app.database import engine

    with engine.begin() as c:
        c.exec_driver_sql("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)")
        c.exec_driver_sql("DELETE FROM alembic_version")
        c.exec_driver_sql(f"INSERT INTO alembic_version VALUES ('{rev}')")


def _build_backup(admin_client, scope="full", include_renditions=True) -> dict:
    job = admin_client.post(BACKUP, json={"scope": scope, "include_renditions": include_renditions})
    assert job.status_code == 202, job.text
    job_id = job.json()["id"]
    status = admin_client.get(f"{BACKUP}/{job_id}").json()
    assert status["status"] == "ready", status
    return status


def _download(admin_client, job_id) -> bytes:
    dl = admin_client.get(f"{BACKUP}/{job_id}/download")
    assert dl.status_code == 200, dl.text
    return dl.content


# --- auth ----------------------------------------------------------------------------------

def test_backup_requires_auth():
    anon = TestClient(app)
    assert anon.post(BACKUP, json={"scope": "full"}).status_code == 401
    assert anon.get(BACKUP).status_code == 401


# --- backup build --------------------------------------------------------------------------

def test_full_backup_contains_db_uploads_and_manifest(admin_client):
    _stamp_revision()
    g = make_gallery(admin_client, "Wedding")
    _upload(admin_client, g["id"])

    status = _build_backup(admin_client, "full")
    data = _download(admin_client, status["id"])

    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        names = tar.getnames()
        manifest = json.loads(tar.extractfile("manifest.json").read())

    assert "db.sqlite3" in names
    assert any(n.startswith("uploads/") for n in names)
    assert manifest["scope"] == "full"
    assert manifest["alembic_revision"] == "0040"
    assert manifest["counts"]["galleries"] == 1
    assert manifest["db_sha256"]


def test_metadata_scope_excludes_uploads(admin_client):
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])

    status = _build_backup(admin_client, "metadata")
    data = _download(admin_client, status["id"])

    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        names = tar.getnames()
    assert "db.sqlite3" in names
    assert not any(n.startswith("uploads/") for n in names)


def test_exclude_renditions_drops_thumb_medium(admin_client):
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])  # processing creates thumb/medium synchronously in tests

    status = _build_backup(admin_client, "full", include_renditions=False)
    data = _download(admin_client, status["id"])
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        names = tar.getnames()
    assert any("/original/" in n for n in names)
    assert not any("/thumb/" in n or "/medium/" in n for n in names)


# --- restore guardrails --------------------------------------------------------------------

def test_restore_wrong_password_rejected(admin_client):
    _stamp_revision()
    g = make_gallery(admin_client, "G")
    status = _build_backup(admin_client, "full")
    archive = _download(admin_client, status["id"])

    r = admin_client.post(
        RESTORE,
        files={"file": ("backup.tar", archive, "application/x-tar")},
        data={"password": "wrong-password"},
    )
    assert r.status_code == 400
    assert r.json().get("code") == "invalid_current_password"


def test_restore_rejects_garbage_archive(admin_client):
    r = admin_client.post(
        RESTORE,
        files={"file": ("backup.tar", b"not a tar at all", "application/x-tar")},
        data={"password": ADMIN_PASSWORD},
    )
    assert r.status_code == 400
    assert r.json().get("code") == "backup_invalid"


def test_restore_refuses_newer_schema(admin_client):
    _stamp_revision()
    g = make_gallery(admin_client, "G")
    status = _build_backup(admin_client, "metadata")
    archive = _download(admin_client, status["id"])

    # Rewrite the manifest to claim a revision this binary doesn't know.
    buf_in = io.BytesIO(archive)
    out = io.BytesIO()
    with tarfile.open(fileobj=buf_in) as src, tarfile.open(fileobj=out, mode="w:gz") as dst:
        for member in src.getmembers():
            if member.name == "manifest.json":
                manifest = json.loads(src.extractfile(member).read())
                manifest["alembic_revision"] = "9999"
                manifest.pop("db_sha256", None)
                payload = json.dumps(manifest).encode()
                member.size = len(payload)
                dst.addfile(member, io.BytesIO(payload))
            else:
                dst.addfile(member, src.extractfile(member))
    out.seek(0)

    r = admin_client.post(
        RESTORE,
        files={"file": ("backup.tar.gz", out.read(), "application/gzip")},
        data={"password": ADMIN_PASSWORD},
    )
    assert r.status_code == 400
    assert r.json().get("code") == "backup_schema_newer"


# --- restore roundtrip ---------------------------------------------------------------------

def test_restore_roundtrip_brings_gallery_back(admin_client, monkeypatch):
    _stamp_revision()
    g = make_gallery(admin_client, "Wedding")
    status = _build_backup(admin_client, "full")
    archive = _download(admin_client, status["id"])

    # Disaster: gallery is gone.
    admin_client.delete(f"/api/galleries/{g['id']}")
    assert admin_client.get(f"/api/galleries/{g['id']}").status_code == 404

    # The snapshot is already at head; skip the real subprocess migration.
    from app import migrations
    monkeypatch.setattr(migrations, "upgrade_to_head", lambda: None)

    r = admin_client.post(
        RESTORE,
        files={"file": ("backup.tar", archive, "application/x-tar")},
        data={"password": ADMIN_PASSWORD},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    back = admin_client.get(f"/api/galleries/{g['id']}")
    assert back.status_code == 200
    assert back.json()["name"] == "Wedding"
