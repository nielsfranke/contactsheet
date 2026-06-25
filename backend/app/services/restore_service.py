# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Restore an instance from a backup archive (the inverse of `tasks/backup_task.py`).

This is at least as destructive as a factory reset — it replaces the entire
instance — so it's guarded by password re-entry on the web path. The cleanest
restore is onto a freshly-deployed empty instance; restoring over a live one is
supported but does an in-process file swap. See docs/architecture/backup-restore.md."""

import hashlib
import json
import logging
import os
import shutil
import tarfile
import tempfile

from fastapi import status

from app.auth.password import verify_password
from app.backup_format import DB_MEMBER, FORMAT_VERSION, MANIFEST_NAME, MEDIA_DIRS
from app.config import settings
from app.errors import CodedHTTPException
from app import migrations
from app.runtime_config import set_secret_key, set_token_version

logger = logging.getLogger(__name__)


def _coded(code: str, detail: str, http_status: int = status.HTTP_400_BAD_REQUEST) -> CodedHTTPException:
    return CodedHTTPException(status_code=http_status, code=code, detail=detail)


def _clear_dir(root: str) -> None:
    """Remove everything inside ``root`` without removing ``root`` itself — keeps the
    static-mount inode valid, exactly as factory reset does."""
    if not os.path.isdir(root):
        return
    for entry in os.scandir(root):
        try:
            if entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry.path, ignore_errors=True)
            else:
                os.remove(entry.path)
        except OSError:
            pass


def _replace_dir_contents(live_root: str, new_root: str) -> None:
    """Swap the *contents* of ``live_root`` for those extracted at ``new_root``."""
    os.makedirs(live_root, exist_ok=True)
    _clear_dir(live_root)
    for entry in os.scandir(new_root):
        shutil.move(entry.path, os.path.join(live_root, entry.name))


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _verify_admin(password: str | None) -> None:
    """Web path only: you must be the current admin to overwrite the instance. A fresh
    instance with no admin yet (host migration) is allowed through."""
    from app.database import SessionLocal
    from app.repositories import settings_repo

    db = SessionLocal()
    try:
        s = settings_repo.get(db)
        if not s.admin_password_hash:
            return  # nothing set up yet — restoring onto an empty instance is fine
        if not password or not verify_password(password, s.admin_password_hash):
            raise _coded("invalid_current_password", "Current password is incorrect")
    finally:
        db.close()


def _read_manifest(extract_dir: str) -> dict:
    path = os.path.join(extract_dir, MANIFEST_NAME)
    if not os.path.isfile(path):
        raise _coded("backup_invalid", "Archive is missing its manifest")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        raise _coded("backup_invalid", "Archive manifest is unreadable")


def _validate(manifest: dict, extract_dir: str) -> None:
    if manifest.get("format_version", 0) > FORMAT_VERSION:
        raise _coded(
            "backup_format_unsupported",
            "This backup was created by a newer ContactSheet. Upgrade before restoring.",
        )
    db_src = os.path.join(extract_dir, DB_MEMBER)
    if not os.path.isfile(db_src):
        raise _coded("backup_invalid", "Archive is missing its database snapshot")
    expected = manifest.get("db_sha256")
    if expected and _sha256(db_src) != expected:
        raise _coded("backup_corrupt", "Database snapshot failed its integrity check")
    revision = manifest.get("alembic_revision")
    if not migrations.is_known_revision(revision):
        raise _coded(
            "backup_schema_newer",
            "This backup's database is from a newer ContactSheet. Upgrade before restoring.",
        )


def _remove_wal_sidecars(live_db: str) -> None:
    for sidecar in (live_db + "-wal", live_db + "-shm"):
        if os.path.exists(sidecar):
            os.remove(sidecar)


def _reload_runtime() -> None:
    """Reload the runtime secret key + token generation from the (restored) settings;
    this invalidates the caller's session, forcing a fresh login."""
    from app.database import SessionLocal
    from app.repositories import settings_repo

    db = SessionLocal()
    try:
        s = settings_repo.get(db)
        if s.secret_key:
            set_secret_key(s.secret_key)
        set_token_version(s.token_version)
    finally:
        db.close()


def _swap_in(extract_dir: str, manifest: dict) -> None:
    """Replace the live DB + media dirs with the archive's, in two phases.

    Phase 1 (DB) is **reversible**: it keeps a ``.bak`` of the live DB and, if the swap or
    forward-migration fails, rolls the DB back and leaves media untouched — so the instance
    is exactly as before. Phase 2 (media) is the **point of no return**: it runs only after
    the DB is committed, because media can't be rolled back transactionally. A failure mid-
    media leaves the restored DB with partially-swapped media, which a re-run (CLI) finishes
    — strictly better than a half-migrated DB stranded next to swapped media."""
    from app.database import engine

    live_db = migrations.sqlite_path()
    db_src = os.path.join(extract_dir, DB_MEMBER)
    backup_db = live_db + ".bak"

    # Drop pooled connections so nothing holds the old DB file open across the swap.
    engine.dispose()

    if os.path.exists(live_db):
        shutil.copy2(live_db, backup_db)

    # --- Phase 1: database (reversible) ---
    try:
        os.makedirs(os.path.dirname(live_db), exist_ok=True)
        shutil.copy2(db_src, live_db)
        _remove_wal_sidecars(live_db)
        migrations.upgrade_to_head()  # migrate the restored snapshot forward
        _reload_runtime()
    except Exception:
        # Roll the DB back so a failed restore doesn't brick the instance. No media has
        # been touched yet, so this returns the instance to its pre-restore state.
        if os.path.exists(backup_db):
            engine.dispose()
            shutil.copy2(backup_db, live_db)
            _remove_wal_sidecars(live_db)
        raise
    finally:
        if os.path.exists(backup_db):
            try:
                os.remove(backup_db)
            except OSError:
                pass

    # --- Phase 2: media (point of no return; DB already committed) ---
    # Only dirs actually present in the archive (metadata-only backups omit uploads, so a
    # metadata restore leaves existing originals untouched).
    for attr, arcname in MEDIA_DIRS.items():
        src = os.path.join(extract_dir, arcname)
        if os.path.isdir(src):
            _replace_dir_contents(getattr(settings, attr), src)


def _regenerate_previews(blocking: bool) -> None:
    """Rebuild renditions the backup omitted (``include_renditions=False``) or that are
    otherwise missing — from the restored originals. Without this a renditions-excluded
    backup restores to a library of broken thumbnails. Blocking on the CLI path (a daemon
    thread wouldn't survive the process exiting); background on the web path."""
    from app.tasks.preview_upgrade import regenerate_missing_previews, upgrade_previews_async

    if blocking:
        regenerate_missing_previews()
    else:
        upgrade_previews_async()


def restore(archive_path: str, *, password: str | None, verify_admin: bool) -> dict:
    """Validate ``archive_path`` and swap its contents over the live instance.

    `verify_admin` is True on the web path (requires the current admin password) and
    False on the CLI path (the operator already owns the host). On the CLI path previews
    are regenerated synchronously so the work finishes before the process exits."""
    if verify_admin:
        _verify_admin(password)

    with tempfile.TemporaryDirectory(dir=settings.exports_dir) as extract_dir:
        try:
            with tarfile.open(archive_path) as tar:
                tar.extractall(extract_dir, filter="data")  # path-traversal-safe (py3.12)
        except (tarfile.TarError, OSError) as exc:
            raise _coded("backup_invalid", f"Archive could not be read: {exc}")

        manifest = _read_manifest(extract_dir)
        _validate(manifest, extract_dir)
        _swap_in(extract_dir, manifest)

    # Rebuild any missing renditions from the restored originals (see _regenerate_previews).
    _regenerate_previews(blocking=not verify_admin)

    logger.info("Restore complete from %s (scope=%s)", archive_path, manifest.get("scope"))
    return {"ok": True, "restored": manifest.get("counts", {})}
