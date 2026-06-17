# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""In-process WebSocket connection hub for live gallery updates.

Holds one "room" of open sockets per ``gallery_id``. Mutations in the request path call the sync
``publish(...)`` helper, which marshals a thin "something changed" signal onto the event loop and
broadcasts it to every socket in that room. Clients respond by invalidating their cached queries
and refetching through the normal (access-gated) REST endpoints — the socket never carries data.

Single-process only: the rooms live in one uvicorn worker, the same assumption the notification
flusher already makes. Multi-worker fan-out would need a shared pub/sub (out of scope).
"""

import asyncio
import json
import logging

from fastapi import WebSocket

_log = logging.getLogger(__name__)


class ConnectionHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Capture the running event loop at startup so sync code can schedule broadcasts."""
        self._loop = loop

    @property
    def loop(self) -> asyncio.AbstractEventLoop | None:
        return self._loop

    def register(self, gallery_id: str, ws: WebSocket) -> None:
        """Add an already-accepted socket to the room. The caller owns the handshake (``accept``)
        so it can ``close(code=…)`` with a meaningful code on auth failure before registering."""
        self._rooms.setdefault(gallery_id, set()).add(ws)

    def disconnect(self, gallery_id: str, ws: WebSocket) -> None:
        room = self._rooms.get(gallery_id)
        if room is None:
            return
        room.discard(ws)
        if not room:
            self._rooms.pop(gallery_id, None)

    async def broadcast(self, gallery_id: str, message: dict) -> None:
        room = self._rooms.get(gallery_id)
        if not room:
            return
        data = json.dumps(message)
        dead: list[WebSocket] = []
        for ws in list(room):
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            room.discard(ws)
        if not self._rooms.get(gallery_id):
            self._rooms.pop(gallery_id, None)


hub = ConnectionHub()


def publish(gallery_id: str, type: str, **fields) -> None:
    """Broadcast a thin signal to every socket watching ``gallery_id``. Sync, never raises.

    Safe to call from sync request handlers (run in Starlette's threadpool) — the broadcast is
    scheduled onto the captured loop via ``run_coroutine_threadsafe``. A no-op before startup
    binds the loop (e.g. in tests) or when nobody is connected.
    """
    loop = hub.loop
    if loop is None:
        return
    try:
        message = {"type": type, "gallery_id": gallery_id, **fields}
        asyncio.run_coroutine_threadsafe(hub.broadcast(gallery_id, message), loop)
    except Exception:  # pragma: no cover - defensive, must never break the request
        _log.exception("realtime publish failed")
