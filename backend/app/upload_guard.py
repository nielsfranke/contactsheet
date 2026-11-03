# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Pre-body gate for the public client upload (`POST /api/public/g/{token}/images`).

FastAPI parses a `File(...)` multipart body — Starlette spools every part to disk under
`settings.spool_dir` — *before* the route handler (and its access checks, rate limit and size caps)
runs. Without this guard an anonymous request to any share token (unknown, password-protected,
client upload off) could stream up to nginx's 8 GB ceiling onto the data volume before being
refused, and parallel requests could eat the free-space reserve that `_ensure_free_space` promises.

So, from the headers alone and before a single body byte is read, this middleware refuses requests
the handler would refuse anyway:

- unknown / deleted / expired gallery (404 / 410), client upload off (403), password-protected
  without a token that unlocks it (401);
- no `Content-Length` (411) — browsers always send one for a FormData upload;
- a declared size above the gallery's request ceiling (413): the guest total
  (`client_upload_max_total_bytes`) or, with `client_upload_large_files`, `max_document_bytes`;
- not enough free space for the declared size **plus** every other in-flight client upload **plus**
  the `client_upload_min_free_bytes` reserve (507).

While the request runs its declared size stays reserved, and the body is counted as it streams: a
client sending more than it declared is cut off. The handler keeps its own, authoritative checks
(per-file caps, formats, pixel limits, rate limit) — this only moves the cheap refusals in front of
the spool.
"""

from __future__ import annotations

import json
import re
import shutil
import threading

from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings

_PATH = re.compile(r"^/api/public/g/([^/]+)/images$")
# Multipart framing (boundaries, part headers, the `uploader` field) on top of the file bytes.
_MULTIPART_SLACK = 2 * 1024 * 1024

_lock = threading.Lock()
_in_flight = 0


class _Refuse(Exception):
    def __init__(self, status: int, code: str | None, detail: str):
        self.status, self.code, self.detail = status, code, detail


def _reserve(nbytes: int) -> int:
    global _in_flight
    with _lock:
        _in_flight += nbytes
        return _in_flight


def _release(nbytes: int) -> None:
    global _in_flight
    with _lock:
        _in_flight -= nbytes


def _preflight(share_token: str, bearer: str | None, declared: int) -> None:
    """Raise `_Refuse` for a request the handler would refuse. Runs in a worker thread (sync DB)."""
    from app import maintenance
    from app.auth.dependencies import gallery_id_from_token_value
    from app.database import SessionLocal
    from app.repositories import gallery_repo
    from app.services import gallery_service

    if maintenance.restore_in_progress.is_set():
        raise _Refuse(503, "maintenance", "Restore in progress — try again shortly")
    with maintenance.request_session():
        db = SessionLocal()
        try:
            gallery = gallery_repo.get_by_share_token(db, share_token)
            if gallery is None:
                raise _Refuse(404, None, "Gallery not found")
            if gallery_service._is_expired(gallery):
                raise _Refuse(410, "gallery_expired", "This gallery has expired")
            if gallery.password_hash:
                access = gallery_id_from_token_value(bearer)
                if access is None or not access.unlocks(gallery):
                    raise _Refuse(401, "gallery_token_required", "Gallery access token required")
            if not gallery.client_upload_enabled:
                raise _Refuse(403, "client_upload_disabled", "Client upload is not enabled for this gallery")
            large = bool(gallery.client_upload_large_files)
        finally:
            db.close()

    ceiling = settings.max_document_bytes if large else settings.client_upload_max_total_bytes
    if declared > ceiling + _MULTIPART_SLACK:
        raise _Refuse(413, "upload_too_large", "Upload too large")


def _check_space(total_in_flight: int) -> None:
    needed = total_in_flight + settings.client_upload_min_free_bytes
    for path in (settings.spool_dir, settings.upload_dir):
        try:
            free = shutil.disk_usage(path).free
        except OSError:
            continue
        if free < needed:
            raise _Refuse(507, "storage_full", "Not enough storage space for this upload")


class ClientUploadGuard:
    """Pure ASGI middleware — it must see the request before anything reads `receive`."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        m = _PATH.match(scope["path"])
        if not m:
            return await self.app(scope, receive, send)

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        auth = headers.get("authorization", "")
        bearer = auth[7:] if auth.startswith("Bearer ") else None
        try:
            declared = int(headers["content-length"])
            if declared < 0:
                raise ValueError
        except (KeyError, ValueError):
            return await _respond(send, _Refuse(411, None, "Content-Length required"))

        try:
            await run_in_threadpool(_preflight, m.group(1), bearer, declared)
        except _Refuse as r:
            return await _respond(send, r)

        total = _reserve(declared)
        try:
            try:
                _check_space(total)
            except _Refuse as r:
                return await _respond(send, r)

            received = 0

            async def counted_receive() -> Message:
                nonlocal received
                message = await receive()
                if message["type"] == "http.request":
                    received += len(message.get("body", b""))
                    if received > declared:
                        # More than declared: stop the body here. The multipart parser sees a
                        # disconnect and the handler never runs on a truncated, oversized upload.
                        return {"type": "http.disconnect"}
                return message

            await self.app(scope, counted_receive, send)
        finally:
            _release(declared)


async def _respond(send: Send, r: _Refuse) -> None:
    body = {"detail": r.detail}
    if r.code:
        body["code"] = r.code
    payload = json.dumps(body).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode()),
               (b"connection", b"close")]
    if r.status == 503:
        headers.append((b"retry-after", b"10"))
    await send({"type": "http.response.start", "status": r.status, "headers": headers})
    await send({"type": "http.response.body", "body": payload})
