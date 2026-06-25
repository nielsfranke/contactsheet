# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Shared constants for the backup archive format — used by both the builder
(`tasks/backup_task.py`) and the restorer (`services/restore_service.py`).

See docs/architecture/backup-restore.md."""

# Bumped only when the *archive layout* (member names / manifest shape) changes
# incompatibly, independent of the DB schema (which is tracked by alembic_revision).
FORMAT_VERSION = 1

MANIFEST_NAME = "manifest.json"
DB_MEMBER = "db.sqlite3"

# Top-level media dirs captured in a "full" backup → their arcname inside the tar.
# `exports` is deliberately absent (regenerable ZIP-job scratch). Keys are config
# attribute names on `app.config.settings`.
MEDIA_DIRS: dict[str, str] = {
    "upload_dir": "uploads",
    "branding_dir": "branding",
    "watermarks_dir": "watermarks",
}

# In a "full" backup, the upload subtree can drop its regenerable renditions when the
# operator opts out. Any path segment matching one of these is a derived rendition;
# `original` is always kept. Must match the variants written by
# image_processing.preview_targets (thumb/small/medium) — restore regenerates them all.
RENDITION_DIR_NAMES = ("thumb", "small", "medium")
# Cached on-the-fly watermark variants live in `<variant>-wm/` dirs.
RENDITION_DIR_SUFFIX = "-wm"
