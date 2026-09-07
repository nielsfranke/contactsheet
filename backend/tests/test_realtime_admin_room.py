# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Instance-wide admin realtime room (``WS /api/ws/admin``).

Gallery *list* changes (create / rename / move / delete …) can't ride a per-gallery room — a
freshly created gallery has no room anyone could be watching. They go to ``ADMIN_ROOM`` instead,
so an admin overview / nav tree learns about out-of-band writes (API-token clients) without a
manual refresh. See docs/architecture/realtime-updates.md.
"""

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.realtime.hub import ADMIN_ROOM, hub, publish, publish_admin
from app.runtime_config import set_token_version

from .helpers import make_gallery


def _ws_close_code(client, path, **kwargs):
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect(path, **kwargs) as ws:
        try:
            ws.receive_text()
            return None
        except WebSocketDisconnect as exc:
            return exc.code


# --- room key ----------------------------------------------------------------------------------

def test_admin_room_key_cannot_collide_with_a_gallery_id():
    """Gallery rooms are keyed by UUIDv4; the reserved admin key must never parse as one."""
    with pytest.raises(ValueError):
        uuid.UUID(ADMIN_ROOM)


# --- endpoint auth (mirrors the per-gallery admin socket) --------------------------------------

def test_admin_room_ws_rejects_missing_invalid_and_stale_cookie(admin_client):
    anon = TestClient(app)
    assert _ws_close_code(anon, "/api/ws/admin") == 4401
    assert _ws_close_code(anon, "/api/ws/admin", headers={"cookie": "access_token=not-a-jwt"}) == 4401

    # A cookie minted before "sign out everywhere" (token_version bump) is rejected too.
    cookie = admin_client.cookies.get("access_token")
    set_token_version(2)
    try:
        assert _ws_close_code(anon, "/api/ws/admin", headers={"cookie": f"access_token={cookie}"}) == 4401
    finally:
        set_token_version(1)


def test_admin_room_ws_rejects_cross_origin(admin_client):
    assert _ws_close_code(admin_client, "/api/ws/admin", headers={"origin": "https://evil.example"}) == 4401


def test_admin_room_ws_accepts_admin_cookie(admin_client):
    with admin_client.websocket_connect("/api/ws/admin", headers={"origin": "http://testserver"}):
        assert hub._rooms.get(ADMIN_ROOM), "admin socket should be registered in ADMIN_ROOM"
    assert not hub._rooms.get(ADMIN_ROOM), "room is dropped once its last socket leaves"


# --- hub: publish_admin targets the admin room only --------------------------------------------

class _FakeSocket:
    def __init__(self):
        self.sent: list[str] = []

    async def send_text(self, data: str) -> None:
        self.sent.append(data)


def test_publish_admin_reaches_admin_room_but_never_a_gallery_room():
    admin_sock, gallery_sock = _FakeSocket(), _FakeSocket()
    gallery_id = str(uuid.uuid4())

    async def scenario():
        hub.bind_loop(asyncio.get_running_loop())
        hub.register(ADMIN_ROOM, admin_sock)
        hub.register(gallery_id, gallery_sock)
        try:
            publish_admin("gallery", gallery_id)
            publish(gallery_id, "image", image_id="img")
            # run_coroutine_threadsafe scheduled the broadcasts onto this loop; let them run.
            for _ in range(5):
                await asyncio.sleep(0)
        finally:
            hub.disconnect(ADMIN_ROOM, admin_sock)
            hub.disconnect(gallery_id, gallery_sock)
            hub._loop = None

    asyncio.run(scenario())
    assert admin_sock.sent == ['{"type": "gallery", "gallery_id": "%s"}' % gallery_id]
    # Public viewers share the gallery room — the admin-list signal must not leak there.
    assert gallery_sock.sent == ['{"type": "image", "gallery_id": "%s", "image_id": "img"}' % gallery_id]


def test_publish_admin_is_a_noop_without_a_bound_loop():
    assert hub.loop is None
    publish_admin("gallery", str(uuid.uuid4()))  # must not raise


# --- service layer: which gallery mutations emit ------------------------------------------------

@pytest.fixture
def admin_signals(monkeypatch):
    """Record every ``publish_admin`` call made from the gallery service as (type, gallery_id)."""
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "app.services.gallery_service.realtime_publish_admin",
        lambda type, gallery_id, **fields: calls.append((type, gallery_id)),
    )
    return calls


def test_gallery_lifecycle_publishes_gallery_signals(admin_client, admin_signals):
    parent = make_gallery(admin_client, "Parent")
    child = make_gallery(admin_client, "Child", parent_id=parent["id"])
    assert admin_signals == [("gallery", parent["id"]), ("gallery", child["id"])]

    admin_signals.clear()
    r = admin_client.patch(f"/api/galleries/{child['id']}", json={"name": "Renamed"})
    assert r.status_code == 200, r.text
    assert admin_signals == [("gallery", child["id"])]

    admin_signals.clear()
    r = admin_client.post(f"/api/galleries/{child['id']}/move", json={"target_parent_id": None})
    assert r.status_code == 200, r.text
    assert admin_signals == [("gallery", child["id"])]

    admin_signals.clear()
    r = admin_client.post(f"/api/galleries/{child['id']}/share-token", json={"strategy": "named"})
    assert r.status_code == 200, r.text
    assert admin_signals == [("gallery", child["id"])]

    admin_signals.clear()
    assert admin_client.delete(f"/api/galleries/{child['id']}").status_code == 204
    assert admin_signals == [("gallery", child["id"])]


def test_noop_update_and_noop_move_do_not_publish(admin_client, admin_signals):
    g = make_gallery(admin_client, "Quiet")
    admin_signals.clear()
    # An empty PATCH changes nothing → nothing to invalidate.
    assert admin_client.patch(f"/api/galleries/{g['id']}", json={}).status_code == 200
    # Moving to where it already is is a no-op too.
    assert admin_client.post(f"/api/galleries/{g['id']}/move", json={"target_parent_id": None}).status_code == 200
    assert admin_signals == []


def test_failed_mutation_does_not_publish(admin_client, admin_signals):
    g = make_gallery(admin_client, "Solo")
    admin_signals.clear()
    assert admin_client.post(f"/api/galleries/{g['id']}/move", json={"target_parent_id": g["id"]}).status_code == 400
    assert admin_client.patch(f"/api/galleries/{uuid.uuid4()}", json={"name": "x"}).status_code == 404
    assert admin_signals == []


# --- end to end: REST create → service → hub → open admin socket --------------------------------

@pytest.fixture
def hub_bound_to_socket_loop(monkeypatch):
    """The lifespan (which binds the hub's loop at startup) doesn't run under a bare TestClient.
    Bind it to the loop the websocket session runs on, at the moment the socket registers — the
    same thing startup does, just late. Unbound again afterwards so the rest of the suite keeps
    ``publish`` a no-op."""
    real_register = hub.register

    def register(room, ws):
        hub.bind_loop(asyncio.get_running_loop())
        real_register(room, ws)

    monkeypatch.setattr(hub, "register", register)
    yield
    hub._loop = None


def test_out_of_band_gallery_create_reaches_open_admin_socket(admin_client, hub_bound_to_socket_loop):
    with admin_client.websocket_connect("/api/ws/admin", headers={"origin": "http://testserver"}) as ws:
        # Simulates an API-token client (desktop uploader) creating a gallery while the admin
        # overview is open in a browser: the browser's cache is never touched, so the socket is
        # the only thing that can tell it.
        g = make_gallery(admin_client, "From the desktop app")
        sub = make_gallery(admin_client, "Sub", parent_id=g["id"])
        assert ws.receive_json() == {"type": "gallery", "gallery_id": g["id"]}
        assert ws.receive_json() == {"type": "gallery", "gallery_id": sub["id"]}
