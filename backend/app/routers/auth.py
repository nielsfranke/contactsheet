# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.config import settings
from app.database import get_db
from app.rate_limit import limiter
from app.repositories import settings_repo
from app.runtime_config import set_token_version
from app.schemas.auth import ChangePasswordRequest, ChangeUsernameRequest, LoginRequest, LoginResponse
from app.services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _cookie_secure(request: Request) -> bool:
    """Mark the session cookie ``Secure`` when configured, or when the request reached the stack
    over HTTPS (the reverse proxy sets ``X-Forwarded-Proto``). This keeps the cookie HTTPS-only on
    any TLS deployment without breaking plain-HTTP local dev — so we don't have to ship an
    insecure-by-default flag that production forgets to flip."""
    if settings.cookie_secure:
        return True
    proto = request.headers.get("x-forwarded-proto", "")
    return proto.split(",")[0].strip().lower() == "https"


@router.post("/login", response_model=LoginResponse)
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    token = auth_service.login(body.username, body.password, db, remember=body.remember)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="strict",
        secure=_cookie_secure(request),
        # Always a *persistent* cookie whose lifetime matches the token's own expiry — 30 days with
        # "Remember me", 24h otherwise. We deliberately avoid a bare session cookie (max_age=None):
        # WebKit (iOS + macOS Safari) drops session cookies unreliably (between tabs, on
        # backgrounding, under ITP), which logged admins out on every visit. The JWT's `exp` still
        # bounds the real session — the cookie just survives long enough to present it.
        max_age=settings.remember_token_ttl if body.remember else settings.access_token_ttl,
    )
    return LoginResponse(access_token=token)


@router.post("/change-password")
@limiter.limit("10/minute")
def change_password(
    request: Request,
    body: ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Rotate the admin password. Signs out other devices (token-version bump) and reissues
    this browser's cookie with a fresh token so the current session stays valid."""
    token = auth_service.change_password(body.current_password, body.new_password, db)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="strict",
        secure=_cookie_secure(request),
        # Persistent cookie matching the reissued 24h token (change_password drops "remember").
        # Not a bare session cookie — see the login handler for why WebKit makes those unreliable.
        max_age=settings.access_token_ttl,
    )
    return {"ok": True}


@router.post("/change-username")
@limiter.limit("10/minute")
def change_username(
    request: Request,
    body: ChangeUsernameRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Rename the admin login. Password-confirmed; the username isn't in the JWT, so the
    current session is untouched."""
    username = auth_service.change_username(body.new_username, body.current_password, db)
    return {"ok": True, "username": username}


@router.post("/logout")
def logout(response: Response, _admin: str = Depends(get_current_admin)):
    response.delete_cookie("access_token")
    return {"ok": True}


@router.post("/logout-all")
def logout_all(response: Response, db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    """Sign out everywhere: bump the token generation so every outstanding admin token
    (other devices/browsers, leaked cookies) is rejected on its next request."""
    new_version = settings_repo.bump_token_version(db)
    set_token_version(new_version)
    response.delete_cookie("access_token")
    return {"ok": True, "token_version": new_version}


@router.get("/me")
def me(db: Session = Depends(get_db), _admin: str = Depends(get_current_admin)):
    return {"username": settings_repo.get(db).admin_username or "admin"}
