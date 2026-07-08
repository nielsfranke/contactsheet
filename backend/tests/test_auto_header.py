# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Auto-fill gallery header (opt-in) — see docs/proposals/auto-header-image.md."""

from types import SimpleNamespace

from app.services import gallery_service

from .helpers import add_image, jpeg_bytes, make_gallery


def _enable(admin_client):
    r = admin_client.patch("/api/admin/settings", json={"auto_header_enabled": True})
    assert r.status_code == 200, r.text


def _public(admin_client, share_token):
    r = admin_client.get(f"/api/public/g/{share_token}")
    assert r.status_code == 200, r.text
    return r.json()


def _set_header(admin_client, gallery_id):
    r = admin_client.post(
        f"/api/galleries/{gallery_id}/header-image",
        files={"file": ("h.jpg", jpeg_bytes(), "image/jpeg")},
    )
    assert r.status_code == 200, r.text


def _tail(url):
    return url.rsplit("/", 1)[-1]


def test_admin_settings_roundtrips_auto_header_flag(admin_client):
    # Regression: the admin settings response must echo the persisted flag, or the settings toggle
    # optimistically flips on then snaps back to the (stale) False the API keeps returning.
    assert admin_client.get("/api/admin/settings").json()["auto_header_enabled"] is False
    r = admin_client.patch("/api/admin/settings", json={"auto_header_enabled": True})
    assert r.status_code == 200, r.text
    assert r.json()["auto_header_enabled"] is True
    assert admin_client.get("/api/admin/settings").json()["auto_header_enabled"] is True


def test_fallback_is_none_when_setting_off(admin_client):
    g = make_gallery(admin_client, "Off")
    add_image(g["id"], sort_order=0)
    add_image(g["id"], sort_order=1)
    body = _public(admin_client, g["share_token"])
    assert body["header_image_fallback_url"] is None


def test_fallback_is_stable_and_avoids_cover_when_enabled(admin_client):
    _enable(admin_client)
    g = make_gallery(admin_client, "On")
    for i in range(3):
        add_image(g["id"], sort_order=i)

    body1 = _public(admin_client, g["share_token"])
    fallback = body1["header_image_fallback_url"]
    assert fallback and "/medium/" in fallback
    # With ≥2 photos the header must differ from the cover (first photo).
    assert _tail(fallback) != _tail(body1["cover_image_url"])
    # Stable across requests (an unstable header would churn the OG preview).
    body2 = _public(admin_client, g["share_token"])
    assert body2["header_image_fallback_url"] == fallback


def test_manual_header_wins_over_fallback(admin_client):
    _enable(admin_client)
    g = make_gallery(admin_client, "Manual")
    add_image(g["id"], sort_order=0)
    add_image(g["id"], sort_order=1)
    _set_header(admin_client, g["id"])

    body = _public(admin_client, g["share_token"])
    assert body["header_image_url"] is not None       # manual header present
    assert body["header_image_fallback_url"] is None   # fallback stands down


def test_container_gallery_has_no_fallback(admin_client):
    _enable(admin_client)
    parent = make_gallery(admin_client, "Container")
    child = make_gallery(admin_client, "Child", parent_id=parent["id"])
    add_image(child["id"], sort_order=0)
    add_image(child["id"], sort_order=1)

    body = _public(admin_client, parent["share_token"])
    assert body["image_count"] == 0                    # container: no own photos
    assert body["header_image_fallback_url"] is None


def test_single_photo_gallery_uses_that_photo(admin_client):
    _enable(admin_client)
    g = make_gallery(admin_client, "Solo")
    add_image(g["id"], sort_order=0)
    body = _public(admin_client, g["share_token"])
    assert body["header_image_fallback_url"] and "/medium/" in body["header_image_fallback_url"]


def test_hero_medium_url_watermark_routes_through_proxy():
    """A watermarked gallery must serve the auto-header via the access-checked proxy (which
    composites the watermark) — never the raw static /uploads path — so it can't leak un-watermarked."""
    gallery = SimpleNamespace(id="gid-1", share_token="tok-1")
    fake_storage = SimpleNamespace(get_url=lambda p: f"/uploads/{p}")

    wm = gallery_service._hero_medium_url(gallery, "img-9", "abc.jpg", True, fake_storage)
    assert wm == "/api/public/g/tok-1/images/img-9/medium"

    plain = gallery_service._hero_medium_url(gallery, "img-9", "abc.jpg", False, fake_storage)
    assert plain == "/uploads/gid-1/medium/abc.jpg"
