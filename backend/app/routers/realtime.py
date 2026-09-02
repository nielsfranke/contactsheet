# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""WebSocket endpoints for live gallery updates.

Both endpoints subscribe a socket to one gallery's room in the connection hub. They carry no
application data upstream — the server ignores inbound frames (they only keep the socket alive).
See ``docs/architecture/realtime-updates.md``.
"""

import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Cookie, Query, WebSocket, WebSocketDisconnect

from app.auth.dependencies import gallery_id_from_token_value, _is_valid_admin
from app.auth.jwt import decode_token
from app.database import SessionLocal
from app.realtime.hub import hub
from app.repositories import gallery_repo

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ws", tags=["realtime"])

# WebSocket close codes (application range). 4401 ≈ unauthorized, 4404 ≈ not found, 4410 ≈ gone.
_CLOSE_UNAUTHORIZED = 4401
_CLOSE_NOT_FOUND = 4404
_CLOSE_GONE = 4410


def _is_expired(gallery) -> bool:
    if not gallery.expires_at:
        return False
    expires = gallery.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires < datetime.now(timezone.utc)


async def _serve(gallery_id: str, websocket: WebSocket) -> None:
    """Register an already-accepted socket in the room, then idle until the client disconnects."""
    hub.register(gallery_id, websocket)
    try:
        while True:
            # Inbound frames are ignored; receiving keeps the connection open and lets us
            # observe a client-side disconnect.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - defensive
        _log.debug("realtime socket error", exc_info=True)
    finally:
        hub.disconnect(gallery_id, websocket)


def _cross_origin(websocket: WebSocket) -> bool:
    """True when the handshake carries an Origin from a different host than the request target.

    Cross-site WebSocket handshakes aren't covered by CORS, so without this the only thing keeping
    a malicious page from riding the admin cookie is SameSite=Strict. Browsers always send Origin
    on WebSocket; a missing Origin (non-browser client) passes — such clients have no ambient
    cookie to steal. Hostname-only comparison: dev/proxy setups rewrite the Host header's port,
    and the threat is a foreign *site*, not a foreign port."""
    origin = websocket.headers.get("origin")
    if not origin:
        return False
    origin_host = urlparse(origin).hostname
    request_host = (websocket.headers.get("host") or "").split(":")[0]
    return not origin_host or not request_host or origin_host.lower() != request_host.lower()


@router.websocket("/admin/galleries/{gallery_id}")
async def admin_gallery_ws(
    websocket: WebSocket,
    gallery_id: str,
    access_token: str | None = Cookie(default=None),
) -> None:
    """Live updates for the admin in-gallery view. Authed via the httponly admin cookie that the
    same-origin handshake carries — validated exactly like ``get_current_admin``."""
    # Accept first so an auth failure can close with a meaningful code (4401) the client can read —
    # otherwise a pre-accept close is a bare handshake rejection (code 1006) and the client can't
    # tell "rejected, stop retrying" from "network blip, reconnect".
    await websocket.accept()
    if _cross_origin(websocket):
        await websocket.close(code=_CLOSE_UNAUTHORIZED)
        return
    payload = None
    if access_token:
        try:
            payload = decode_token(access_token)
        except Exception:
            payload = None
    if not payload or not _is_valid_admin(payload):
        await websocket.close(code=_CLOSE_UNAUTHORIZED)
        return
    await _serve(gallery_id, websocket)


@router.websocket("/public/g/{share_token}")
async def public_gallery_ws(
    websocket: WebSocket,
    share_token: str,
    token: str | None = Query(default=None),
) -> None:
    """Live updates for a public client gallery. Password-gated galleries require the gallery JWT
    in ``?token=`` (browsers can't set a WS Authorization header); password-less galleries are open,
    mirroring the REST access rule."""
    # Accept first so the close codes below (4404 / 4401) reach the client (see admin handler).
    await websocket.accept()
    db = SessionLocal()
    try:
        gallery = gallery_repo.get_by_share_token(db, share_token)
        if gallery is None:
            await websocket.close(code=_CLOSE_NOT_FOUND)
            return
        # An expired gallery is gone over REST (410); don't keep its live socket open either.
        if _is_expired(gallery):
            await websocket.close(code=_CLOSE_GONE)
            return
        if gallery.password_hash:
            authorized = False
            if token:
                access = gallery_id_from_token_value(token)
                authorized = access is not None and access.unlocks(gallery)
            if not authorized:
                await websocket.close(code=_CLOSE_UNAUTHORIZED)
                return
        gallery_id = gallery.id
    finally:
        db.close()

    await _serve(gallery_id, websocket)
