# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings
from app.runtime_config import get_secret_key, get_token_version

_ALGORITHM = "HS256"


def create_admin_token(remember: bool = False) -> str:
    now = datetime.now(timezone.utc)
    ttl = settings.remember_token_ttl if remember else settings.access_token_ttl
    payload = {
        "sub": "admin",
        "type": "admin",
        "ver": get_token_version(),
        "iat": now,
        "exp": now + timedelta(seconds=ttl),
    }
    return jwt.encode(payload, get_secret_key(), algorithm=_ALGORITHM)


def create_gallery_token(gallery_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": "gallery_access",
        "type": "gallery",
        "gallery_id": gallery_id,
        "iat": now,
        "exp": now + timedelta(seconds=settings.gallery_token_ttl),
    }
    return jwt.encode(payload, get_secret_key(), algorithm=_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and verify a JWT. Raises InvalidTokenError on failure."""
    return jwt.decode(token, get_secret_key(), algorithms=[_ALGORITHM])
