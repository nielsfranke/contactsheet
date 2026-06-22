# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import Cookie, Depends, Header, HTTPException, status
from jwt import InvalidTokenError

from app.auth.jwt import decode_token
from app.runtime_config import get_token_version


def _extract_bearer(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:]
    return None


def _is_valid_admin(payload: dict) -> bool:
    """An admin token is valid only if it carries the current token generation. Bumping
    token_version (sign out everywhere) invalidates every previously issued token."""
    return payload.get("type") == "admin" and payload.get("ver") == get_token_version()


def get_current_admin(
    access_token: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
) -> str:
    token = access_token or _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if not _is_valid_admin(payload):
            raise ValueError
    except (InvalidTokenError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return "admin"


def get_optional_admin(
    access_token: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
) -> bool:
    """True if the request carries a valid admin token (cookie or bearer), else False.

    Used to suppress side effects (e.g. view notifications) when the photographer previews
    their own gallery through the public URL.
    """
    token = access_token or _extract_bearer(authorization)
    if not token:
        return False
    try:
        payload = decode_token(token)
        return _is_valid_admin(payload)
    except InvalidTokenError:
        return False


def gallery_id_from_token_value(token: str | None) -> str | None:
    """Decode a gallery JWT supplied as a raw value (e.g. a ?token= query param — browsers can't set
    an Authorization header on a navigation/download). Returns the gallery_id, or None."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        if payload.get("type") != "gallery":
            return None
        return payload.get("gallery_id")
    except InvalidTokenError:
        return None


def get_optional_gallery_token(
    authorization: str | None = Header(default=None),
) -> str | None:
    """Returns the gallery JWT payload dict, or None if no token provided."""
    return gallery_id_from_token_value(_extract_bearer(authorization))


def require_gallery_token(
    authorization: str | None = Header(default=None),
) -> str:
    gallery_id = get_optional_gallery_token(authorization)
    if not gallery_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Gallery access token required")
    return gallery_id
