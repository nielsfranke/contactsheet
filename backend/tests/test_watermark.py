# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Watermark settings validation + activation rules."""

import json

import pytest
from pydantic import ValidationError

from app.schemas.watermark import WatermarkSettings

from .helpers import make_gallery


def test_defaults_are_inactive():
    ws = WatermarkSettings()
    assert ws.enabled is False and ws.is_active() is False


def test_text_mode_active_only_with_text():
    assert WatermarkSettings(enabled=True, mode="text", text="© Studio").is_active() is True
    assert WatermarkSettings(enabled=True, mode="text", text="   ").is_active() is False
    assert WatermarkSettings(enabled=True, mode="text", text=None).is_active() is False


def test_image_mode_active_only_with_filename():
    assert WatermarkSettings(enabled=True, mode="image", filename="wm.png").is_active() is True
    assert WatermarkSettings(enabled=True, mode="image", filename=None).is_active() is False


def test_disabled_is_never_active():
    assert WatermarkSettings(enabled=False, mode="text", text="x").is_active() is False


def test_opacity_bounds():
    with pytest.raises(ValidationError):
        WatermarkSettings(opacity=150)
    with pytest.raises(ValidationError):
        WatermarkSettings(opacity=-1)


def test_bad_color_rejected():
    with pytest.raises(ValidationError):
        WatermarkSettings(color="red")
    assert WatermarkSettings(color="#aabbcc").color == "#aabbcc"


def test_invalid_position_rejected():
    with pytest.raises(ValidationError):
        WatermarkSettings(position="middle")


def test_legacy_shape_stays_valid_and_inactive():
    # Old rows had only filename/opacity/size/position, no enabled/mode.
    ws = WatermarkSettings.model_validate({"filename": "old.png", "opacity": 40, "size": "large", "position": "center"})
    assert ws.enabled is False and ws.is_active() is False


def test_extra_keys_ignored():
    ws = WatermarkSettings.model_validate({"enabled": True, "mode": "text", "text": "x", "bogus": 1})
    assert ws.is_active() is True


# --- through the gallery update endpoint -----------------------------------------------------

def test_update_gallery_rejects_invalid_watermark_json(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.patch(f"/api/galleries/{g['id']}", json={"watermark_settings": "{not json"})
    assert r.status_code == 400


def test_update_gallery_normalizes_watermark(admin_client):
    g = make_gallery(admin_client, "G")
    payload = json.dumps({"enabled": True, "mode": "text", "text": "© Me", "opacity": 30})
    r = admin_client.patch(f"/api/galleries/{g['id']}", json={"watermark_settings": payload})
    assert r.status_code == 200
    stored = json.loads(r.json()["watermark_settings"])
    assert stored["enabled"] is True and stored["text"] == "© Me" and stored["opacity"] == 30


def test_update_gallery_rejects_out_of_range_watermark(admin_client):
    g = make_gallery(admin_client, "G")
    payload = json.dumps({"enabled": True, "mode": "text", "text": "x", "opacity": 999})
    assert admin_client.patch(f"/api/galleries/{g['id']}", json={"watermark_settings": payload}).status_code == 400


def test_settings_change_drops_composited_cache(admin_client):
    """The wm cache is keyed per settings-hash — superseded hashes must not linger on disk."""
    import os

    from app.config import settings

    g = make_gallery(admin_client, "WM")
    cache_dir = os.path.join(settings.upload_dir, g["id"], "thumb-wm")
    os.makedirs(cache_dir, exist_ok=True)
    stale = os.path.join(cache_dir, "img_deadbeef.jpg")
    open(stale, "wb").write(b"stale")

    ws = {"enabled": True, "mode": "text", "text": "© Studio"}
    r = admin_client.patch(f"/api/galleries/{g['id']}", json={"watermark_settings": json.dumps(ws)})
    assert r.status_code == 200
    assert not os.path.exists(stale)


def test_image_watermark_filename_is_confined_to_the_gallery_dir(tmp_path, monkeypatch):
    """`filename` comes from admin-controlled JSON; a `../` must never leave the gallery's dir."""
    import os
    from PIL import Image as _PIL
    from app.config import settings as cfg
    from app.services import watermark_service

    monkeypatch.setattr(cfg, "watermarks_dir", str(tmp_path))
    outside = tmp_path / "secret.png"
    _PIL.new("RGBA", (4, 4), (255, 0, 0, 255)).save(outside)
    base = _PIL.new("RGB", (32, 32), (0, 0, 0))
    ws = WatermarkSettings(filename="../secret.png", opacity=100, size="large")
    out = watermark_service._apply_image_watermark(base, ws, "gid")
    assert out is base  # untouched: the traversal was refused, not followed
    assert not os.path.exists(tmp_path / "gid")


def test_active_text_watermark_changes_the_served_pixels(admin_client, db):
    """`is_active` is the only gate between clean previews and composited ones — prove the proxy
    actually serves different bytes than the file on disk when the watermark is on."""
    import os
    from app.config import settings as cfg
    from fastapi.testclient import TestClient
    from app.main import app
    from .helpers import png_bytes

    g = make_gallery(admin_client, "WM")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/images",
        files=[("files", ("p.png", png_bytes(color=(200, 30, 30), size=(400, 300)), "image/png"))],
    )
    img = r.json()[0]
    from app.repositories import image_repo
    stored = image_repo.get_by_id(db, img["id"]).stored_filename
    on_disk = open(os.path.join(cfg.upload_dir, g["id"], "thumb", stored), "rb").read()

    ws = {"enabled": True, "mode": "text", "text": "© Studio", "opacity": 90, "size": "large", "position": "center"}
    admin_client.patch(f"/api/galleries/{g['id']}", json={"watermark_settings": json.dumps(ws)})
    pub = TestClient(app)
    listing = pub.get(f"/api/public/g/{g['share_token']}/images").json()[0]
    assert listing["thumb_url"].startswith("/api/public/") and listing["original_url"] is None
    served = pub.get(listing["thumb_url"])
    assert served.status_code == 200 and served.content != on_disk

    admin_client.patch(f"/api/galleries/{g['id']}", json={"watermark_settings": json.dumps({**ws, "enabled": False})})
    listing = pub.get(f"/api/public/g/{g['share_token']}/images").json()[0]
    assert listing["thumb_url"].startswith("/uploads/") and listing["original_url"]
    # The static mount (nginx in production) serves the untouched rendition.
    assert open(os.path.join(cfg.upload_dir, g["id"], "thumb", stored), "rb").read() == on_disk
    assert img["id"]
