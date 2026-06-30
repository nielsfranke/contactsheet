# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Personal access tokens for third-party API clients (export plugins, scripts).

Tokens are high-entropy random secrets, so a fast SHA-256 with the unique-index lookup is the
right store (bcrypt is for low-entropy passwords). The plaintext is `cs_pat_<token_urlsafe>` and
is returned exactly once at creation; only its hash is persisted. A token authenticates as the
admin but is constrained to its granted scopes — `require_scope` in auth/dependencies gates the
handful of endpoints a plugin needs (gallery read/write, image upload) and nothing else."""

import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.api_token import ApiToken
from app.repositories import api_token_repo

TOKEN_PREFIX = "cs_pat_"

# The full scope vocabulary. Deliberately coarse and forward-compatible: enough for the Capture
# One / Lightroom export flow (create galleries + upload), and explicitly excluding anything
# destructive or administrative (settings, reset, backup, token management).
SCOPES = {"galleries:read", "galleries:write", "images:read", "images:write"}


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate(db: Session, *, name: str, scopes: list[str],
             expires_at: datetime | None = None) -> tuple[ApiToken, str]:
    """Mint a new token. Returns (row, plaintext_secret); the secret is never stored or shown again."""
    unknown = sorted(set(scopes) - SCOPES)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown scope(s): {', '.join(unknown)}",
        )
    secret = TOKEN_PREFIX + secrets.token_urlsafe(32)
    tok = api_token_repo.create(
        db,
        name=name,
        token_hash=_hash(secret),
        prefix=secret[:12],
        scopes=sorted(set(scopes)),
        expires_at=expires_at,
    )
    return tok, secret


def authenticate(db: Session, raw: str | None) -> ApiToken | None:
    """Resolve a raw `cs_pat_…` secret to its token row, or None if absent/unknown/expired.
    Touches `last_used_at` on success. Scope checks happen in the dependency, not here."""
    if not raw or not raw.startswith(TOKEN_PREFIX):
        return None
    tok = api_token_repo.get_by_hash(db, _hash(raw))
    if tok is None:
        return None
    if tok.expires_at is not None and tok.expires_at <= datetime.now(timezone.utc):
        return None
    api_token_repo.touch(db, tok)
    return tok
