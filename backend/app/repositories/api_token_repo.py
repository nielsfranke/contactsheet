# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.api_token import ApiToken


def create(db: Session, *, name: str, token_hash: str, prefix: str, scopes: list[str],
           expires_at: datetime | None = None) -> ApiToken:
    tok = ApiToken(name=name, token_hash=token_hash, prefix=prefix, scopes=scopes, expires_at=expires_at)
    db.add(tok)
    db.commit()
    db.refresh(tok)
    return tok


def get_by_hash(db: Session, token_hash: str) -> ApiToken | None:
    return db.scalar(select(ApiToken).where(ApiToken.token_hash == token_hash))


def list_all(db: Session) -> list[ApiToken]:
    return list(db.scalars(select(ApiToken).order_by(ApiToken.created_at.desc())))


def delete(db: Session, token_id: str) -> bool:
    tok = db.get(ApiToken, token_id)
    if not tok:
        return False
    db.delete(tok)
    db.commit()
    return True


def touch(db: Session, tok: ApiToken) -> None:
    """Record this token's most recent use (for the admin 'last used' column)."""
    tok.last_used_at = datetime.now(timezone.utc)
    db.commit()
