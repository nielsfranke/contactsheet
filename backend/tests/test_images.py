# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Image upload, move, delete, moderation, and the like-follows-move regression."""

import json
import os

from app.config import settings
from app.database import SessionLocal
from app.repositories import image_repo, like_repo

from .helpers import make_gallery, add_image, png_bytes


def _upload(admin_client, gallery_id, data, content_type="image/png", name="p.png"):
    return admin_client.post(
        f"/api/galleries/{gallery_id}/images",
        files=[("files", (name, data, content_type))],
    )


def test_upload_real_png_processes(admin_client):
    g = make_gallery(admin_client, "G")
    r = _upload(admin_client, g["id"], png_bytes())
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body) == 1 and body[0]["is_video"] is False
    # Processing runs synchronously in tests (see conftest._synchronous_image_processing).
    imgs = admin_client.get(f"/api/galleries/{g['id']}/images").json()
    assert len(imgs) == 1 and imgs[0]["processing_status"] == "done"
    assert imgs[0]["thumb_url"]


def test_upload_rejects_unsupported_type(admin_client):
    g = make_gallery(admin_client, "G")
    r = _upload(admin_client, g["id"], b"%PDF-1.4 fake", content_type="application/pdf", name="x.pdf")
    assert r.status_code == 415 and r.json()["code"] == "upload_unsupported_type"


def test_upload_trusts_bytes_not_content_type(admin_client):
    g = make_gallery(admin_client, "G")
    # The format is sniffed from the bytes, so a spoofed content_type/extension can't smuggle a
    # different type: real PNG bytes labelled as a PDF are accepted as the PNG they actually are.
    r = _upload(admin_client, g["id"], png_bytes(), content_type="application/pdf", name="x.pdf")
    assert r.status_code == 201, r.text


def test_upload_rejects_garbage_bytes(admin_client):
    g = make_gallery(admin_client, "G")
    # Bytes that match no known format are rejected regardless of the declared image content_type.
    r = _upload(admin_client, g["id"], b"not really a png", content_type="image/png")
    assert r.status_code == 415 and r.json()["code"] == "upload_unsupported_type"


def test_delete_image_soft_deletes(admin_client):
    g = make_gallery(admin_client, "G")
    img = add_image(g["id"])
    assert admin_client.delete(f"/api/images/{img}").status_code == 204
    assert admin_client.get(f"/api/galleries/{g['id']}/images").json() == []


def test_move_image_between_galleries(admin_client):
    a = make_gallery(admin_client, "A")
    b = make_gallery(admin_client, "B")
    img = add_image(a["id"])
    r = admin_client.post(f"/api/images/{img}/move", json={"target_gallery_id": b["id"]})
    assert r.status_code == 200
    assert admin_client.get(f"/api/galleries/{a['id']}/images").json() == []
    assert len(admin_client.get(f"/api/galleries/{b['id']}/images").json()) == 1


def test_move_image_relocates_all_renditions(admin_client):
    """Regression: moving a photo must relocate every on-disk rendition tier (original + thumb +
    small + medium) to the target gallery's dir. `small` was historically left behind, so its URL —
    rebuilt from the new gallery id — 404'd and previews broke in the destination."""
    from app.config import settings

    a = make_gallery(admin_client, "A")
    b = make_gallery(admin_client, "B")
    # Upload a real image so the pipeline writes actual rendition files (synchronous in tests).
    img_id = _upload(admin_client, a["id"], png_bytes()).json()[0]["id"]

    db = SessionLocal()
    try:
        stored = image_repo.get_by_id(db, img_id).stored_filename
    finally:
        db.close()

    tiers = ("original", "thumb", "small", "medium")
    for tier in tiers:  # all present in the source gallery before the move
        assert os.path.exists(os.path.join(settings.upload_dir, a["id"], tier, stored)), tier

    assert admin_client.post(f"/api/images/{img_id}/move", json={"target_gallery_id": b["id"]}).status_code == 200

    for tier in tiers:
        assert os.path.exists(os.path.join(settings.upload_dir, b["id"], tier, stored)), f"{tier} missing in target"
        assert not os.path.exists(os.path.join(settings.upload_dir, a["id"], tier, stored)), f"{tier} orphaned in source"


def test_move_image_to_missing_gallery_404(admin_client):
    a = make_gallery(admin_client, "A")
    img = add_image(a["id"])
    assert admin_client.post(f"/api/images/{img}/move", json={"target_gallery_id": "ghost"}).status_code == 404


def test_likes_follow_image_on_move(admin_client):
    """Regression: per-reviewer likes are filtered by gallery_id, so they must be reassigned when
    an image moves — otherwise the heart reads empty in the destination gallery."""
    a = make_gallery(admin_client, "A", mode="collaboration")
    b = make_gallery(admin_client, "B", mode="collaboration")
    for g in (a, b):
        admin_client.patch(f"/api/galleries/{g['id']}", json={"likes_enabled": True})
    img = add_image(a["id"])

    # Reviewer likes the image while it lives in gallery A.
    like = admin_client.post(
        f"/api/public/g/{a['share_token']}/images/{img}/like", json={"reviewer": "Alice"}
    )
    assert like.status_code == 200 and like.json()["likes"] == 1

    # Move it to gallery B.
    admin_client.post(f"/api/images/{img}/move", json={"target_gallery_id": b["id"]})

    db = SessionLocal()
    try:
        # The like now belongs to gallery B for that reviewer.
        assert like_repo.liked_image_ids(db, b["id"], "Alice") == [img]
        assert like_repo.liked_image_ids(db, a["id"], "Alice") == []
    finally:
        db.close()

    # And the public "my likes" endpoint reflects it through B's share token.
    mine = admin_client.get(f"/api/public/g/{b['share_token']}/likes", params={"reviewer": "Alice"})
    assert mine.json() == [img]


# --- Duplicate-filename resolution (Replace / Keep both / Skip) --------------------------------

def _upload_named(admin_client, gallery_id, data, name, actions=None):
    form = {"duplicate_actions": json.dumps(actions)} if actions is not None else None
    return admin_client.post(
        f"/api/galleries/{gallery_id}/images",
        files=[("files", (name, data, "image/png"))],
        data=form,
    )


def _stored_name(image_id):
    db = SessionLocal()
    try:
        return image_repo.get_by_id(db, image_id).stored_filename
    finally:
        db.close()


def _tier_exists(gallery_id, tier, stored):
    return os.path.exists(os.path.join(settings.upload_dir, gallery_id, tier, stored))


def test_check_duplicates_reports_live_matches(admin_client):
    g = make_gallery(admin_client, "G")
    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png")
    r = admin_client.post(
        f"/api/galleries/{g['id']}/images/check-duplicates",
        json={"filenames": ["IMG_1.png", "IMG_2.png"]},
    )
    assert r.status_code == 200
    assert r.json()["duplicates"] == {"IMG_1.png": 1}


def test_upload_without_actions_appends_duplicate(admin_client):
    """Backward-compat: no duplicate_actions field → legacy silent append (PAT clients rely on this)."""
    g = make_gallery(admin_client, "G")
    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png")
    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png")
    imgs = admin_client.get(f"/api/galleries/{g['id']}/images").json()
    assert [i["original_filename"] for i in imgs] == ["IMG_1.png", "IMG_1.png"]


def test_upload_skip_drops_the_file(admin_client):
    g = make_gallery(admin_client, "G")
    first = _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png").json()[0]["id"]
    r = _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png", actions={"IMG_1.png": "skip"})
    assert r.status_code == 201 and r.json() == []
    imgs = admin_client.get(f"/api/galleries/{g['id']}/images").json()
    assert [i["id"] for i in imgs] == [first]


def test_upload_keep_both_renames_to_v2(admin_client):
    g = make_gallery(admin_client, "G")
    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png")
    r = _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png", actions={"IMG_1.png": "keep_both"})
    assert r.status_code == 201 and r.json()[0]["original_filename"] == "IMG_1_v2.png"
    names = {i["original_filename"] for i in admin_client.get(f"/api/galleries/{g['id']}/images").json()}
    assert names == {"IMG_1.png", "IMG_1_v2.png"}


def test_upload_replace_overwrites_in_place(admin_client):
    """Replace keeps the image id (so feedback survives), swaps the pixels, and clears stale renditions."""
    g = make_gallery(admin_client, "G")
    first = _upload_named(admin_client, g["id"], png_bytes(size=(16, 16)), "IMG_1.png").json()[0]["id"]
    old_stored = _stored_name(first)
    # Attach feedback that must survive the replace.
    assert admin_client.patch(f"/api/images/{first}", json={"rating": 5}).status_code == 200

    r = _upload_named(
        admin_client, g["id"], png_bytes(size=(40, 40)), "IMG_1.png", actions={"IMG_1.png": "replace"}
    )
    assert r.status_code == 201
    assert r.json()[0]["id"] == first  # same row, not a new one

    imgs = admin_client.get(f"/api/galleries/{g['id']}/images").json()
    assert len(imgs) == 1
    assert imgs[0]["id"] == first and imgs[0]["rating"] == 5   # id + feedback preserved
    assert imgs[0]["width"] == 40                              # new pixels

    new_stored = _stored_name(first)
    assert new_stored != old_stored
    for tier in ("original", "thumb", "small", "medium"):
        assert _tier_exists(g["id"], tier, new_stored), f"new {tier} missing"
        assert not _tier_exists(g["id"], tier, old_stored), f"old {tier} orphaned"


def test_upload_replace_updates_gallery_cover(admin_client):
    """A cover pinned to a photo follows a replace-in-place (issue #3) because the image id is kept."""
    g = make_gallery(admin_client, "G")
    img = _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png").json()[0]["id"]
    admin_client.patch(f"/api/galleries/{g['id']}", json={"cover_image_id": img})
    old_stored = _stored_name(img)
    assert old_stored in admin_client.get(f"/api/galleries/{g['id']}").json()["cover_image_url"]

    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png", actions={"IMG_1.png": "replace"})
    body = admin_client.get(f"/api/galleries/{g['id']}").json()
    assert body["cover_image_id"] == img                       # still the same pinned photo
    assert _stored_name(img) in body["cover_image_url"]        # now showing the new bytes
    assert old_stored not in body["cover_image_url"]


def test_upload_replace_with_multiple_matches_keeps_one(admin_client):
    """When several live images already share the name, replace overwrites the newest and soft-deletes
    the older siblings so exactly one live image keeps that name."""
    g = make_gallery(admin_client, "G")
    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png")
    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png")  # legacy duplicate
    assert len(admin_client.get(f"/api/galleries/{g['id']}/images").json()) == 2

    _upload_named(admin_client, g["id"], png_bytes(), "IMG_1.png", actions={"IMG_1.png": "replace"})
    imgs = admin_client.get(f"/api/galleries/{g['id']}/images").json()
    assert len(imgs) == 1 and imgs[0]["original_filename"] == "IMG_1.png"


def test_psd_psb_tiff_get_document_size_cap(admin_client, monkeypatch):
    """PSD/PSB/TIFF are capped by max_document_bytes (multi-GB), regular images by max_upload_bytes.
    Caps are shrunk here so a tiny file exceeds the image cap yet fits the document cap."""
    import io as _io
    from PIL import Image as _PILImage
    from app.config import settings
    from .helpers import psb_bytes

    monkeypatch.setattr(settings, "max_upload_bytes", 10)            # 10 bytes — regular images
    monkeypatch.setattr(settings, "max_document_bytes", 10_000_000)  # 10 MB — large documents
    g = make_gallery(admin_client, "G")

    def up(name, data, ct):
        return admin_client.post(f"/api/galleries/{g['id']}/images", files=[("files", (name, data, ct))])

    # A regular image blows the tiny 10-byte image cap → rejected.
    r = up("p.png", png_bytes(), "image/png")
    assert r.status_code == 413 and r.json()["code"] == "upload_too_large"

    # PSB and TIFF ride the document cap → accepted (well under 10 MB).
    assert up("doc.psb", psb_bytes(), "application/octet-stream").status_code == 201
    tif = _io.BytesIO(); _PILImage.new("RGB", (8, 8), (1, 2, 3)).save(tif, "TIFF")
    assert up("doc.tif", tif.getvalue(), "image/tiff").status_code == 201


def test_moderation_approve_makes_public(admin_client):
    g = make_gallery(admin_client, "G", mode="collaboration")
    img = add_image(g["id"], moderation_status="pending")
    assert admin_client.get(f"/api/public/g/{g['share_token']}/images").json() == []
    assert admin_client.post(f"/api/galleries/{g['id']}/images/{img}/approve").status_code == 200
    assert len(admin_client.get(f"/api/public/g/{g['share_token']}/images").json()) == 1


def test_upload_response_schema_accepts_no_preview():
    # "no_preview" is persisted by the processing task (e.g. a PSB without an embedded
    # thumbnail) and can surface in an UploadResponse via the replace-in-place path —
    # the Literal missing it turned such uploads into a 500.
    from app.schemas.image import UploadResponse

    r = UploadResponse(
        id="x", original_filename="art.psb", file_size=1, mime_type="image/vnd.adobe.photoshop",
        processing_status="no_preview",
    )
    assert r.processing_status == "no_preview"


def test_bulk_transfer_move_appends_and_carries_likes(admin_client):
    """The batched transfer path must keep move_image's semantics: images append after the
    target's existing photos in request order, and per-reviewer likes follow to the new
    gallery (they're filtered by gallery_id)."""
    a = make_gallery(admin_client, "A", mode="collaboration")
    b = make_gallery(admin_client, "B", mode="collaboration")
    for g in (a, b):
        admin_client.patch(f"/api/galleries/{g['id']}", json={"likes_enabled": True})
    img1 = add_image(a["id"], filename="one.jpg", sort_order=0)
    img2 = add_image(a["id"], filename="two.jpg", sort_order=1)
    existing = add_image(b["id"], filename="existing.jpg", sort_order=0)

    like = admin_client.post(
        f"/api/public/g/{a['share_token']}/images/{img1}/like", json={"reviewer": "Alice"}
    )
    assert like.status_code == 200

    r = admin_client.post(
        f"/api/galleries/{a['id']}/images/transfer",
        json={"image_ids": [img2, img1], "target_gallery_id": b["id"], "operation": "move"},
    )
    assert r.status_code == 200 and r.json()["count"] == 2

    imgs = admin_client.get(f"/api/galleries/{b['id']}/images").json()
    order = [(i["id"], i["sort_order"]) for i in sorted(imgs, key=lambda i: i["sort_order"])]
    assert order == [(existing, 0), (img2, 1), (img1, 2)]
    assert admin_client.get(f"/api/galleries/{a['id']}/images").json() == []

    db = SessionLocal()
    try:
        assert like_repo.liked_image_ids(db, b["id"], "Alice") == [img1]
        assert like_repo.liked_image_ids(db, a["id"], "Alice") == []
    finally:
        db.close()
