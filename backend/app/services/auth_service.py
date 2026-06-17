# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth.jwt import create_admin_token
from app.auth.password import hash_password, verify_password
from app.errors import CodedHTTPException
from app.repositories import settings_repo
from app.runtime_config import set_token_version


def login(username: str, password: str, db: Session, remember: bool = False) -> str:
    s = settings_repo.get(db)
    if not s.setup_complete:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Setup not complete")
    if username != s.admin_username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not s.admin_password_hash or not verify_password(password, s.admin_password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return create_admin_token(remember)


def change_password(current_password: str, new_password: str, db: Session) -> str:
    """Rotate the admin password. Revokes every other outstanding session (bumps the
    token version) and returns a fresh token for the current device so the caller can
    reissue its cookie and stay signed in."""
    s = settings_repo.get(db)
    if not s.admin_password_hash or not verify_password(current_password, s.admin_password_hash):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_current_password",
            detail="Current password is incorrect",
        )
    if verify_password(new_password, s.admin_password_hash):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="password_unchanged",
            detail="New password must differ from the current one",
        )
    settings_repo.update(db, admin_password_hash=hash_password(new_password))
    new_version = settings_repo.bump_token_version(db)
    set_token_version(new_version)
    return create_admin_token(remember=False)


def change_username(new_username: str, current_password: str, db: Session) -> str:
    """Rename the admin login. Requires the current password to confirm identity. The username
    isn't carried in the JWT, so no session is touched. Returns the stored username."""
    s = settings_repo.get(db)
    if not s.admin_password_hash or not verify_password(current_password, s.admin_password_hash):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_current_password",
            detail="Current password is incorrect",
        )
    new = new_username.strip()
    if not new:
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="username_unchanged",
            detail="Username must not be empty",
        )
    if new == s.admin_username:
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="username_unchanged",
            detail="New username must differ from the current one",
        )
    settings_repo.update(db, admin_username=new)
    return new
