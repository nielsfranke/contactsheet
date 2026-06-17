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
