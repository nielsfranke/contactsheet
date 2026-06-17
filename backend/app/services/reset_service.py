# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import os
import secrets
import shutil

from fastapi import status
from sqlalchemy.orm import Session

from app.auth.password import verify_password
from app.config import settings
from app.database import Base
from app.errors import CodedHTTPException
from app.models.app_settings import AppSettings
from app.repositories import settings_repo
from app.runtime_config import set_secret_key, set_token_version

# Dirs whose *contents* are wiped (the roots themselves stay so the running process's
# static mounts remain valid).
_MEDIA_DIRS = (
    settings.upload_dir,
    settings.exports_dir,
    settings.branding_dir,
    settings.watermarks_dir,
)


def _clear_dir(root: str) -> None:
    """Remove everything inside ``root`` without removing ``root`` itself. Only ever
    touches entries directly under the configured dir — no traversal outside it."""
    if not os.path.isdir(root):
        return
    for entry in os.scandir(root):
        try:
            if entry.is_dir(follow_symlinks=False):
                shutil.rmtree(entry.path, ignore_errors=True)
            else:
                os.remove(entry.path)
        except OSError:
            # Best-effort: a locked/already-gone file shouldn't abort the reset.
            pass


def factory_reset(password: str, db: Session) -> None:
    """Return the instance to a fresh-install state: purge all data + media files, reset
    settings, clear the admin account, and rotate the secret key (logging everyone out).
    Requires the current admin password — verified before anything is deleted."""
    s = settings_repo.get(db)
    if not s.admin_password_hash or not verify_password(password, s.admin_password_hash):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_current_password",
            detail="Current password is incorrect",
        )

    # 1. Hard-delete every table except app_settings, children-first (FK-safe with
    #    PRAGMA foreign_keys=ON). Data-driven so new tables are covered automatically.
    for table in reversed(Base.metadata.sorted_tables):
        if table.name != "app_settings":
            db.execute(table.delete())
    db.commit()

    # 2. Wipe media/branding/export/watermark files from disk.
    for root in _MEDIA_DIRS:
        _clear_dir(root)

    # 3. Reset settings to defaults: drop the singleton and recreate it, then rotate the
    #    secret key. This clears setup_complete + admin credentials and invalidates every
    #    outstanding token, so the next request lands on /setup.
    db.query(AppSettings).delete()
    db.commit()
    fresh = settings_repo.get(db)  # recreates id=1 with model defaults (setup_complete=False)
    new_key = secrets.token_hex(32)
    settings_repo.update(db, secret_key=new_key)
    set_secret_key(new_key)
    set_token_version(fresh.token_version)
