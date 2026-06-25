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
import os
import tarfile
import tempfile

import pytest
from fastapi.testclient import TestClient

from app import migrations
from app.config import settings as cfg
from app.main import app
from app.services import restore_service
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


def test_regenerate_previews_endpoint(admin_client):
    anon = TestClient(app)
    assert anon.post("/api/admin/settings/regenerate-previews").status_code == 401
    r = admin_client.post("/api/admin/settings/regenerate-previews")
    assert r.status_code == 200 and r.json()["ok"] is True


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
    # all three derived tiers are excluded (thumb/small/medium), originals kept
    assert not any(f"/{v}/" in n for n in names for v in ("thumb", "small", "medium"))


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


def test_restore_regenerates_missing_previews(admin_client, monkeypatch):
    """A renditions-excluded backup must restore to working previews, not broken thumbs:
    restore regenerates the missing thumb/small/medium from the restored originals."""
    import os
    import tempfile

    from app import migrations
    from app.config import settings as cfg
    from app.services import restore_service

    _stamp_revision()
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])  # sync processing makes original + thumb/small/medium

    status = _build_backup(admin_client, "full", include_renditions=False)
    archive = _download(admin_client, status["id"])

    monkeypatch.setattr(migrations, "upgrade_to_head", lambda: None)
    fd, path = tempfile.mkstemp(suffix=".tar")
    os.write(fd, archive)
    os.close(fd)
    # CLI/blocking path → previews regenerated synchronously before returning
    restore_service.restore(path, password=None, verify_admin=False)

    gdir = os.path.join(cfg.upload_dir, g["id"])
    assert os.listdir(os.path.join(gdir, "original")), "originals missing after restore"
    for variant in ("thumb", "medium"):
        vdir = os.path.join(gdir, variant)
        assert os.path.isdir(vdir) and os.listdir(vdir), f"{variant} not regenerated after restore"


# --- edge cases: malformed / hostile archives ----------------------------------------------

def _members(archive: bytes) -> dict[str, bytes]:
    """Extract regular-file members of a tar into {name: bytes}."""
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        return {m.name: tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}


def _make_tar(members: dict[str, bytes], *, gzip: bool = False) -> bytes:
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz" if gzip else "w") as tar:
        for name, payload in members.items():
            ti = tarfile.TarInfo(name)
            ti.size = len(payload)
            tar.addfile(ti, io.BytesIO(payload))
    return out.getvalue()


def _restore_via_api(admin_client, archive: bytes, *, name="backup.tar", ctype="application/x-tar"):
    return admin_client.post(
        RESTORE,
        files={"file": (name, archive, ctype)},
        data={"password": ADMIN_PASSWORD},
    )


def test_restore_rejects_corrupted_db_snapshot(admin_client):
    """The manifest's db_sha256 must catch a tampered/truncated DB snapshot before any swap."""
    _stamp_revision()
    make_gallery(admin_client, "G")
    status = _build_backup(admin_client, "full")
    mem = _members(_download(admin_client, status["id"]))

    mem["db.sqlite3"] = mem["db.sqlite3"] + b"bit-rot"  # bytes change → sha256 mismatch
    r = _restore_via_api(admin_client, _make_tar(mem))
    assert r.status_code == 400
    assert r.json().get("code") == "backup_corrupt"


def test_restore_rejects_archive_without_manifest(admin_client):
    """A structurally valid tar that has no manifest.json is refused, not crashed on."""
    archive = _make_tar({"db.sqlite3": b"SQLite format 3\x00 not really"})
    r = _restore_via_api(admin_client, archive)
    assert r.status_code == 400
    assert r.json().get("code") == "backup_invalid"


def test_restore_rejects_archive_without_db_snapshot(admin_client):
    """A tar carrying only a manifest (no db.sqlite3) is refused."""
    manifest = json.dumps({"format_version": 1, "alembic_revision": "0040"}).encode()
    archive = _make_tar({"manifest.json": manifest})
    r = _restore_via_api(admin_client, archive)
    assert r.status_code == 400
    assert r.json().get("code") == "backup_invalid"


def test_restore_rejects_path_traversal_archive(admin_client):
    """A hostile member escaping the extract dir must not be written to disk (tar 'data' filter)."""
    _stamp_revision()
    make_gallery(admin_client, "G")
    status = _build_backup(admin_client, "full")
    mem = _members(_download(admin_client, status["id"]))
    mem["../escape.txt"] = b"pwned"  # would land in exports_dir, outside the temp extract dir

    sentinel = os.path.join(cfg.exports_dir, "escape.txt")
    if os.path.exists(sentinel):
        os.remove(sentinel)

    r = _restore_via_api(admin_client, _make_tar(mem))
    assert r.status_code == 400
    assert r.json().get("code") == "backup_invalid"
    assert not os.path.exists(sentinel), "path-traversal member escaped the extract dir"


# --- edge cases: reliability of the swap ---------------------------------------------------

def test_restore_rolls_back_db_when_migration_fails(admin_client, monkeypatch):
    """If the forward migration fails mid-restore, the DB is rolled back from .bak and media is
    left untouched — the instance must end up exactly as it was before the restore attempt."""
    _stamp_revision()
    before = make_gallery(admin_client, "Before")
    status = _build_backup(admin_client, "full")
    archive = _download(admin_client, status["id"])

    # Exists only in the live instance, not in the snapshot — proves the DB wasn't swapped.
    after = make_gallery(admin_client, "After")

    def boom():
        raise RuntimeError("migration blew up")

    monkeypatch.setattr(migrations, "upgrade_to_head", boom)

    fd, path = tempfile.mkstemp(suffix=".tar")
    os.write(fd, archive)
    os.close(fd)
    with pytest.raises(RuntimeError):
        restore_service.restore(path, password=None, verify_admin=False)

    # DB rolled back: both galleries (including the post-backup one) are still present.
    assert admin_client.get(f"/api/galleries/{before['id']}").status_code == 200
    assert admin_client.get(f"/api/galleries/{after['id']}").status_code == 200


def test_full_restore_round_trips_original_file_bytes(admin_client, monkeypatch):
    """The whole point of a full backup: an original photo's bytes survive the roundtrip exactly."""
    _stamp_revision()
    g = make_gallery(admin_client, "G")
    payload = png_bytes(color=(7, 77, 177), size=(20, 20))
    up = admin_client.post(
        f"/api/galleries/{g['id']}/images",
        files=[("files", ("u.png", payload, "image/png"))],
    )
    assert up.status_code in (200, 201), up.text

    odir = os.path.join(cfg.upload_dir, g["id"], "original")
    stored = os.listdir(odir)[0]
    with open(os.path.join(odir, stored), "rb") as f:
        before = f.read()

    status = _build_backup(admin_client, "full")
    archive = _download(admin_client, status["id"])

    os.remove(os.path.join(odir, stored))  # disaster: the original is gone

    monkeypatch.setattr(migrations, "upgrade_to_head", lambda: None)
    r = _restore_via_api(admin_client, archive)
    assert r.status_code == 200, r.text

    with open(os.path.join(odir, stored), "rb") as f:
        assert f.read() == before, "restored original is not byte-identical"


def test_metadata_restore_preserves_existing_uploads(admin_client, monkeypatch):
    """A metadata-only archive carries no uploads/, so restore must leave on-disk originals
    untouched (only the DB + branding + watermarks are swapped). Also exercises the gzip path."""
    _stamp_revision()
    g = make_gallery(admin_client, "G")
    admin_client.post(
        f"/api/galleries/{g['id']}/images",
        files=[("files", ("u.png", png_bytes(), "image/png"))],
    )
    odir = os.path.join(cfg.upload_dir, g["id"], "original")
    stored = os.listdir(odir)[0]

    status = _build_backup(admin_client, "metadata")  # tar.gz, no uploads/
    archive = _download(admin_client, status["id"])

    admin_client.delete(f"/api/galleries/{g['id']}")  # disaster in the DB only

    monkeypatch.setattr(migrations, "upgrade_to_head", lambda: None)
    r = _restore_via_api(admin_client, archive, name="backup.tar.gz", ctype="application/gzip")
    assert r.status_code == 200, r.text

    # DB row is back, and the metadata restore never wiped the original off disk.
    assert admin_client.get(f"/api/galleries/{g['id']}").status_code == 200
    assert os.path.exists(os.path.join(odir, stored)), "metadata restore wiped existing uploads"


def test_full_restore_replaces_whole_instance(admin_client, monkeypatch):
    """Full restore is a complete replacement: a gallery (and its files) created after the
    backup must be gone afterwards — the uploads dir is cleared and swapped, not merged."""
    _stamp_revision()
    kept = make_gallery(admin_client, "Kept")
    status = _build_backup(admin_client, "full")
    archive = _download(admin_client, status["id"])

    later = make_gallery(admin_client, "Later")
    admin_client.post(
        f"/api/galleries/{later['id']}/images",
        files=[("files", ("u.png", png_bytes(), "image/png"))],
    )
    later_dir = os.path.join(cfg.upload_dir, later["id"])
    assert os.path.isdir(later_dir)

    monkeypatch.setattr(migrations, "upgrade_to_head", lambda: None)
    r = _restore_via_api(admin_client, archive)
    assert r.status_code == 200, r.text

    assert admin_client.get(f"/api/galleries/{kept['id']}").status_code == 200
    assert admin_client.get(f"/api/galleries/{later['id']}").status_code == 404
    assert not os.path.exists(later_dir), "uploads dir was merged, not replaced"
