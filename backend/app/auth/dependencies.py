# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import Cookie, Depends, Header, HTTPException, status
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.auth.jwt import decode_token
from app.database import get_db
from app.runtime_config import get_token_version
from app.services import api_token_service


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


def require_scope(scope: str):
    """Build a dependency that admits either the admin (cookie or admin JWT — full access) **or** a
    personal access token (`Authorization: Bearer cs_pat_…`) that carries `scope`.

    This is the only door a PAT can open: it gates the handful of endpoints an export plugin needs
    (gallery read/write, image upload). Every other admin endpoint keeps `get_current_admin`, where a
    PAT simply fails to decode → 401, so tokens can never reach settings, reset or token management."""

    def dependency(
        access_token: str | None = Cookie(default=None),
        authorization: str | None = Header(default=None),
        db: Session = Depends(get_db),
    ) -> str:
        # 1. Admin via cookie or admin JWT bearer → full access (implicitly holds every scope).
        admin_token = access_token or _extract_bearer(authorization)
        if admin_token and not admin_token.startswith(api_token_service.TOKEN_PREFIX):
            try:
                if _is_valid_admin(decode_token(admin_token)):
                    return "admin"
            except InvalidTokenError:
                pass
        # 2. Personal access token in the Authorization header — must exist, be valid, and hold the scope.
        raw = _extract_bearer(authorization)
        if raw and raw.startswith(api_token_service.TOKEN_PREFIX):
            tok = api_token_service.authenticate(db, raw)
            if tok is None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
            if scope not in tok.scopes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Token is missing the required scope: {scope}",
                )
            return "token"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    return dependency
