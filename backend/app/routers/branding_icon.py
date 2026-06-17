# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Public branding icon endpoints (favicon + PWA app icons), rendered from the instance branding.

Mounted under /api/branding/ (not /branding/, which is a StaticFiles mount) so it rides the existing
/api dev proxy + prod nginx location. See docs/architecture/branding-aware-favicon.md.
"""

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.repositories import settings_repo
from app.services import branding_icon

router = APIRouter(prefix="/api/branding", tags=["branding"])

_CACHE_CONTROL = "public, max-age=300, must-revalidate"


def _serve(kind: str, request: Request, db: Session) -> Response:
    s = settings_repo.get(db)
    etag = f'"{branding_icon.signature(s)}-{kind}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": _CACHE_CONTROL})
    data = branding_icon.render(s, kind)
    media = "image/x-icon" if kind == "favicon" else "image/png"
    return Response(content=data, media_type=media,
                    headers={"ETag": etag, "Cache-Control": _CACHE_CONTROL})


@router.get("/favicon.ico")
def favicon(request: Request, db: Session = Depends(get_db)) -> Response:
    return _serve("favicon", request, db)


@router.get("/icon-192.png")
def icon_192(request: Request, db: Session = Depends(get_db)) -> Response:
    return _serve("any192", request, db)


@router.get("/icon-512.png")
def icon_512(request: Request, db: Session = Depends(get_db)) -> Response:
    return _serve("any512", request, db)


@router.get("/icon-maskable.png")
def icon_maskable(request: Request, db: Session = Depends(get_db)) -> Response:
    return _serve("maskable", request, db)


@router.get("/apple-touch-icon.png")
def apple_touch_icon(request: Request, db: Session = Depends(get_db)) -> Response:
    return _serve("apple", request, db)


@router.get("/manifest.webmanifest")
def manifest(request: Request, db: Session = Depends(get_db)) -> Response:
    """PWA web app manifest, served here so theme_color can derive from the instance accent.
    background_color stays dark (the immersive splash tone)."""
    s = settings_repo.get(db)
    etag = f'"{branding_icon.signature(s)}-manifest"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": _CACHE_CONTROL})
    body = {
        "name": "ContactSheet",
        "short_name": "ContactSheet",
        "description": "Self-hosted photo delivery for photographers",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0a0a0b",
        "theme_color": branding_icon.theme_color(s),
        "icons": [
            {"src": "/api/branding/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/api/branding/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/api/branding/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    return JSONResponse(
        body,
        media_type="application/manifest+json",
        headers={"ETag": etag, "Cache-Control": _CACHE_CONTROL},
    )
