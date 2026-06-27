# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Build a full-instance backup archive in the background.

Mirrors the async ZIP-job flow (`tasks/zip_task.py`): a `BackupJob` row tracks
pending → running → ready|error and the on-disk artifact lives under
`exports_dir/backups/`. See docs/architecture/backup-restore.md.

Consistency: the DB is captured with ``VACUUM INTO`` (a checkpointed, sidecar-free
single-file snapshot — never tar the live WAL `.db`), and media files are copied
*before* the DB snapshot. The upload path writes a file to disk before committing
its row, so a DB-last ordering guarantees every row references a file that already
existed when files were copied — the only possible skew is a harmless orphan file."""

import hashlib
import io
import json
import logging
import os
import sqlite3
import tarfile
from datetime import datetime, timezone

from app.backup_format import (
    DB_MEMBER,
    FORMAT_VERSION,
    MANIFEST_NAME,
    MEDIA_DIRS,
    RENDITION_DIR_NAMES,
    RENDITION_DIR_SUFFIX,
)
from app.config import settings
from app.database import SessionLocal
from app.migrations import revision_of_db, sqlite_path
from app.repositories import backup_job_repo
from app.version import __version__

logger = logging.getLogger(__name__)


def _backups_dir() -> str:
    return os.path.join(settings.exports_dir, "backups")


def _is_rendition(path: str) -> bool:
    """True for derived (regenerable) rendition files inside an upload subtree:
    `<gallery>/thumb/…`, `<gallery>/medium/…`, or cached `<variant>-wm/…`."""
    parts = path.split(os.sep)
    return any(
        seg in RENDITION_DIR_NAMES or seg.endswith(RENDITION_DIR_SUFFIX) for seg in parts
    )


def _vacuum_snapshot(dest: str) -> None:
    """Write a consistent single-file snapshot of the live DB via ``VACUUM INTO``."""
    if os.path.exists(dest):
        os.remove(dest)
    con = sqlite3.connect(sqlite_path())
    try:
        con.execute("VACUUM INTO ?", (dest,))
    finally:
        con.close()


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _counts() -> dict[str, int]:
    from app.models.gallery import Gallery
    from app.models.image import Image

    db = SessionLocal()
    try:
        return {
            "galleries": db.query(Gallery).count(),
            "images": db.query(Image).count(),
        }
    finally:
        db.close()


def build_backup(job_id: str, scope: str, include_renditions: bool) -> None:
    db = SessionLocal()
    snapshot_path: str | None = None
    try:
        job = backup_job_repo.get(db, job_id)
        if not job:
            return
        backup_job_repo.update_status(db, job, "running")

        os.makedirs(_backups_dir(), exist_ok=True)

        # 1. Media first, DB last (see module docstring). Snapshot the DB to a temp file.
        snapshot_path = os.path.join(_backups_dir(), f"{job_id}.db.tmp")

        gzip = scope == "metadata"  # full is mostly already-compressed media; metadata is DB/text
        ext = "tar.gz" if gzip else "tar"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        archive_path = os.path.join(_backups_dir(), f"contactsheet-backup-{stamp}-{job_id[:8]}.{ext}")

        # Which media dirs to include for this scope.
        include_dirs = dict(MEDIA_DIRS)
        if scope == "metadata":
            include_dirs.pop("upload_dir", None)

        def _filter(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
            if scope == "full" and not include_renditions and _is_rendition(info.name):
                return None
            return info

        with tarfile.open(archive_path, "w:gz" if gzip else "w") as tar:
            # Add media before snapshotting the DB.
            for attr, arcname in include_dirs.items():
                root = getattr(settings, attr)
                if os.path.isdir(root):
                    tar.add(root, arcname=arcname, filter=_filter)

            # Snapshot the DB now (after media) and add it + the manifest.
            _vacuum_snapshot(snapshot_path)
            manifest = {
                "format_version": FORMAT_VERSION,
                "app_version": __version__,
                "alembic_revision": revision_of_db(snapshot_path),
                "scope": scope,
                "includes_renditions": bool(include_renditions) if scope == "full" else False,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "db_sha256": _sha256(snapshot_path),
                "counts": _counts(),
            }
            manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
            mi = tarfile.TarInfo(MANIFEST_NAME)
            mi.size = len(manifest_bytes)
            tar.addfile(mi, io.BytesIO(manifest_bytes))
            tar.add(snapshot_path, arcname=DB_MEMBER)

        size = os.path.getsize(archive_path)
        backup_job_repo.update_status(db, job, "ready", file_path=archive_path, size_bytes=size)
        logger.info("Backup built: %s (%d bytes, scope=%s)", archive_path, size, scope)

    except Exception as exc:
        logger.error("Backup build failed for job %s: %s", job_id, exc)
        try:
            job = backup_job_repo.get(db, job_id)
            if job:
                backup_job_repo.update_status(db, job, "error", error_message=str(exc))
        except Exception:
            pass
    finally:
        if snapshot_path and os.path.exists(snapshot_path):
            try:
                os.remove(snapshot_path)
            except OSError:
                pass
        db.close()
