# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from app.models.app_settings import AppSettings


def get(db: Session) -> AppSettings:
    settings = db.get(AppSettings, 1)
    if not settings:
        settings = AppSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def update(db: Session, **kwargs) -> AppSettings:
    settings = get(db)
    for key, value in kwargs.items():
        setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return settings


def claim_setup(db: Session, username: str, password_hash: str) -> bool:
    """Atomically complete the first-run setup: write the admin account *only if* setup isn't
    already complete. Returns True if this call claimed it, False if another request got there
    first. The single conditional UPDATE closes the check-then-set race in the setup wizard (two
    concurrent POSTs both passing a prior `setup_complete` check)."""
    get(db)  # ensure the singleton row exists
    result = db.execute(
        sa_update(AppSettings)
        .where(AppSettings.id == 1, AppSettings.setup_complete.is_(False))
        .values(setup_complete=True, admin_username=username, admin_password_hash=password_hash)
    )
    db.commit()
    return result.rowcount > 0


def bump_token_version(db: Session) -> int:
    """Increment the admin-session generation (revokes all outstanding admin tokens). Returns
    the new version."""
    settings = get(db)
    settings.token_version = (settings.token_version or 1) + 1
    db.commit()
    db.refresh(settings)
    return settings.token_version
