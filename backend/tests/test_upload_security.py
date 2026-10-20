# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Upload-pipeline / media-serving / moderation hardening (findings 1–4)."""

import io

from PIL import Image as PilImage

from app.config import settings as app_settings

from .helpers import make_gallery, add_image, png_bytes, psb_bytes


def tiff_bytes(color=(40, 160, 90), size=(16, 16)) -> bytes:
    buf = io.BytesIO()
    PilImage.new("RGB", size, color).save(buf, format="TIFF")
    return buf.getvalue()


def _upload(admin_client, gallery_id, data=None, content_type="image/png", name="p.png"):
    return admin_client.post(
        f"/api/galleries/{gallery_id}/images",
        files=[("files", (name, data or png_bytes(), content_type))],
    )


# --- Finding 1: downloads-disabled / watermark must not leak the original path ----------------

def test_downloads_disabled_proxies_variants_and_hides_stored_name(admin_client):
    g = make_gallery(admin_client, "ViewOnly", mode="presentation")
    _upload(admin_client, g["id"])
    admin_client.patch(f"/api/galleries/{g['id']}", json={"downloads_enabled": False})

    imgs = admin_client.get(f"/api/public/g/{g['share_token']}/images").json()
    assert len(imgs) == 1
    img = imgs[0]
    # Variants go through the access-checked proxy (by image id), not /uploads/{g}/thumb/{uuid}.
    assert img["thumb_url"].startswith(f"/api/public/g/{g['share_token']}/images/{img['id']}/")
    assert "/uploads/" not in (img["thumb_url"] or "")
    assert "/uploads/" not in (img["medium_url"] or "")
    # The original is not offered, and nothing leaks the stored_filename that would let a viewer
    # derive the sibling original/ static path.
    assert img["original_url"] is None
    blob = " ".join(str(img.get(k)) for k in ("thumb_url", "small_url", "medium_url"))
    assert "/original/" not in blob

    # And the proxy actually serves the rendition (access-checked, file present).
    assert admin_client.get(img["thumb_url"]).status_code == 200


def test_downloads_enabled_keeps_fast_static_urls(admin_client):
    g = make_gallery(admin_client, "Open", mode="presentation")
    _upload(admin_client, g["id"])  # downloads_enabled defaults True, no watermark
    img = admin_client.get(f"/api/public/g/{g['share_token']}/images").json()[0]
    assert img["thumb_url"].startswith("/uploads/")  # unchanged fast path
    assert img["original_url"].startswith("/uploads/")


# --- Finding 2: decompression-bomb / pixel cap ------------------------------------------------

def test_oversized_image_rejected_before_decode(admin_client, monkeypatch):
    # Force the area cap below a tiny test image so the guard trips deterministically.
    monkeypatch.setattr(app_settings, "max_image_pixels", 100)  # 16x16 = 256 px > 100
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])  # processing runs synchronously under TestClient
    img = admin_client.get(f"/api/galleries/{g['id']}/images").json()[0]
    assert img["processing_status"] == "error"


def test_normal_image_within_cap_processes(admin_client):
    g = make_gallery(admin_client, "G")
    _upload(admin_client, g["id"])
    img = admin_client.get(f"/api/galleries/{g['id']}/images").json()[0]
    assert img["processing_status"] == "done"


# --- Finding 3: client-upload byte caps -------------------------------------------------------

def test_client_upload_per_file_cap(admin_client, monkeypatch):
    g = make_gallery(admin_client, "G", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True})
    monkeypatch.setattr(app_settings, "client_upload_max_file_bytes", 10)  # tiny

    r = admin_client.post(
        f"/api/public/g/{g['share_token']}/images",
        files=[("files", ("p.png", png_bytes(), "image/png"))],
        data={"uploader": "Alice"},
    )
    assert r.status_code == 413 and r.json()["code"] == "upload_too_large"


def test_admin_upload_unaffected_by_client_cap(admin_client, monkeypatch):
    # The client cap must not constrain admin uploads.
    monkeypatch.setattr(app_settings, "client_upload_max_file_bytes", 10)
    g = make_gallery(admin_client, "G")
    assert _upload(admin_client, g["id"]).status_code == 201


def test_client_upload_total_request_cap(admin_client, monkeypatch):
    g = make_gallery(admin_client, "G", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_enabled": True})
    one = png_bytes()
    # Allow a single file but not two.
    monkeypatch.setattr(app_settings, "client_upload_max_file_bytes", len(one) + 50)
    monkeypatch.setattr(app_settings, "client_upload_max_total_bytes", len(one) + 10)

    r = admin_client.post(
        f"/api/public/g/{g['share_token']}/images",
        files=[
            ("files", ("a.png", one, "image/png")),
            ("files", ("b.png", one, "image/png")),
        ],
        data={"uploader": "Alice"},
    )
    assert r.status_code == 413 and r.json()["code"] == "upload_too_large"


# --- Large-files opt-in (client_upload_large_files): admin-tier caps for one gallery ----------

def _client_post(admin_client, g, files):
    return admin_client.post(
        f"/api/public/g/{g['share_token']}/images", files=files, data={"uploader": "Alice"},
    )


def _large_files_gallery(admin_client, on: bool):
    g = make_gallery(admin_client, "G", mode="collaboration")
    admin_client.patch(
        f"/api/galleries/{g['id']}",
        json={"client_upload_enabled": True, "client_upload_large_files": on},
    )
    return g


def test_client_upload_rejects_working_documents_by_default(admin_client):
    g = _large_files_gallery(admin_client, on=False)
    for name, data in (("art.psb", psb_bytes()), ("scan.tif", tiff_bytes())):
        r = _client_post(admin_client, g, [("files", (name, data, "application/octet-stream"))])
        assert r.status_code == 415 and r.json()["code"] == "client_upload_unsupported_type"


def test_client_upload_large_files_accepts_psb_and_tiff(admin_client):
    g = _large_files_gallery(admin_client, on=True)
    r = _client_post(admin_client, g, [
        ("files", ("art.psb", psb_bytes(with_thumbnail=True), "application/octet-stream")),
        ("files", ("scan.tif", tiff_bytes(), "image/tiff")),
    ])
    assert r.status_code == 201, r.text
    imgs = admin_client.get(f"/api/galleries/{g['id']}/images").json()
    assert sorted(i["original_filename"] for i in imgs) == ["art.psb", "scan.tif"]
    assert all(i["processing_status"] == "done" and i["uploaded_by"] == "Alice" for i in imgs)


def test_client_upload_large_files_still_rejects_raw_and_video(admin_client):
    g = _large_files_gallery(admin_client, on=True)
    # Camera RAW (LibRaw) stays admin-only even with the opt-in; so does video.
    raw = b"II*\x00\x10\x00\x00\x00CR\x02\x00" + b"\x00" * 64
    r = _client_post(admin_client, g, [("files", ("x.cr2", raw, "application/octet-stream"))])
    assert r.status_code == 415
    mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
    r = _client_post(admin_client, g, [("files", ("v.mp4", mp4, "video/mp4"))])
    assert r.status_code == 415 and r.json()["code"] == "client_upload_video"


def test_client_upload_large_files_lifts_byte_caps(admin_client, monkeypatch):
    g = _large_files_gallery(admin_client, on=True)
    monkeypatch.setattr(app_settings, "client_upload_max_file_bytes", 10)
    monkeypatch.setattr(app_settings, "client_upload_max_total_bytes", 10)
    r = _client_post(admin_client, g, [
        ("files", ("a.png", png_bytes(), "image/png")),
        ("files", ("b.png", png_bytes(), "image/png")),
    ])
    assert r.status_code == 201, r.text


def test_client_upload_large_files_lifts_pixel_cap(admin_client, monkeypatch):
    monkeypatch.setattr(app_settings, "client_upload_max_pixels", 10)  # 16x16 = 256 px > 10
    strict = _large_files_gallery(admin_client, on=False)
    large = _large_files_gallery(admin_client, on=True)
    for g in (strict, large):
        assert _client_post(admin_client, g, [("files", ("p.png", png_bytes(), "image/png"))]).status_code == 201
    status_of = lambda g: admin_client.get(f"/api/galleries/{g['id']}/images").json()[0]["processing_status"]
    assert status_of(strict) == "error"
    assert status_of(large) == "done"


def test_client_upload_large_files_exposed_publicly(admin_client):
    g = _large_files_gallery(admin_client, on=True)
    pub = admin_client.get(f"/api/public/g/{g['share_token']}").json()
    assert pub["client_upload_large_files"] is True


def test_client_upload_refused_when_storage_low(admin_client, monkeypatch):
    g = _large_files_gallery(admin_client, on=True)
    monkeypatch.setattr(app_settings, "client_upload_min_free_bytes", 1 << 62)  # more than any disk
    r = _client_post(admin_client, g, [("files", ("p.png", png_bytes(), "image/png"))])
    assert r.status_code == 507 and r.json()["code"] == "storage_full"
    # Admin uploads carry no reserve.
    assert _upload(admin_client, g["id"]).status_code == 201


def test_client_upload_large_files_never_cascades_or_inherits(admin_client):
    parent = make_gallery(admin_client, "P", mode="collaboration")
    child = make_gallery(admin_client, "C", parent_id=parent["id"], mode="collaboration")
    admin_client.patch(f"/api/galleries/{parent['id']}", json={
        "client_upload_enabled": True, "client_upload_large_files": True, "apply_to_subgalleries": True,
    })
    got = admin_client.get(f"/api/galleries/{child['id']}").json()
    assert got["client_upload_enabled"] is True  # the regular toggle cascades…
    assert got["client_upload_large_files"] is False  # …the security relaxation doesn't
    new_child = make_gallery(admin_client, "N", parent_id=parent["id"], mode="collaboration")
    assert new_child["client_upload_large_files"] is False


# --- Broad format support (Phase 1): TIFF accepted, PSB rejected ------------------------------

def test_tiff_upload_processes_to_done(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/images",
        files=[("files", ("scan.tif", tiff_bytes(), "image/tiff"))],
    )
    assert r.status_code == 201, r.text
    img = admin_client.get(f"/api/galleries/{g['id']}/images").json()[0]
    # TIFF goes through the normal Pillow pipeline → JPEG renditions exist.
    assert img["processing_status"] == "done" and img["thumb_url"]


def test_psb_with_embedded_thumbnail_renders(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/images",
        files=[("files", ("art.psb", psb_bytes(with_thumbnail=True), "application/octet-stream"))],
    )
    assert r.status_code == 201, r.text
    img = admin_client.get(f"/api/galleries/{g['id']}/images").json()[0]
    # The embedded thumbnail becomes the preview → normal "done" with renditions.
    assert img["processing_status"] == "done" and img["thumb_url"]


def test_psb_without_thumbnail_is_no_preview(admin_client):
    g = make_gallery(admin_client, "G")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/images",
        files=[("files", ("flat.psb", psb_bytes(with_thumbnail=False), "application/octet-stream"))],
    )
    assert r.status_code == 201, r.text
    img = admin_client.get(f"/api/galleries/{g['id']}/images").json()[0]
    # Stored & downloadable, but no rendition: a "no_preview" download-only asset.
    assert img["processing_status"] == "no_preview"
    assert img["thumb_url"] is None and img["original_url"]


# --- Finding 4: moderation gate on per-image endpoints ----------------------------------------

def test_pending_image_blocked_on_per_image_endpoints(admin_client):
    g = make_gallery(admin_client, "Mod", mode="collaboration")
    admin_client.patch(
        f"/api/galleries/{g['id']}",
        json={"client_upload_moderation": True, "comments_enabled": True, "likes_enabled": True},
    )
    pending = add_image(g["id"], moderation_status="pending")
    t = g["share_token"]

    # Variant serving, comments listing, flag, like, vote, and comment-add all 404 a pending image.
    assert admin_client.get(f"/api/public/g/{t}/images/{pending}/thumb").status_code == 404
    assert admin_client.get(f"/api/public/g/{t}/images/{pending}/comments").status_code == 404
    assert admin_client.post(f"/api/public/g/{t}/images/{pending}/flag", json={"flag": "green"}).status_code == 404
    assert admin_client.post(f"/api/public/g/{t}/images/{pending}/like", json={"reviewer": "A"}).status_code == 404
    assert admin_client.post(
        f"/api/public/g/{t}/images/{pending}/comments", json={"author_name": "A", "text": "hi"}
    ).status_code == 404


def test_approved_image_reachable_on_per_image_endpoints(admin_client):
    g = make_gallery(admin_client, "Mod", mode="collaboration")
    admin_client.patch(f"/api/galleries/{g['id']}", json={"client_upload_moderation": True})
    approved = add_image(g["id"], moderation_status="approved")
    t = g["share_token"]
    # Approved image is flaggable (not blocked by the moderation gate).
    assert admin_client.post(f"/api/public/g/{t}/images/{approved}/flag", json={"flag": "green"}).status_code == 200
