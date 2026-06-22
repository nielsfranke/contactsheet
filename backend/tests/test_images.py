# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Image upload, move, delete, moderation, and the like-follows-move regression."""

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


def test_move_image_to_missing_gallery_404(admin_client):
    a = make_gallery(admin_client, "A")
    img = add_image(a["id"])
    assert admin_client.post(f"/api/images/{img}/move", json={"target_gallery_id": "ghost"}).status_code == 404


def test_likes_follow_image_on_move(admin_client):
    """Regression: per-reviewer likes are filtered by gallery_id, so they must be reassigned when
    an image moves — otherwise the heart reads empty in the destination gallery."""
    a = make_gallery(admin_client, "A", mode="collaboration")
    b = make_gallery(admin_client, "B", mode="collaboration")
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


def test_moderation_approve_makes_public(admin_client):
    g = make_gallery(admin_client, "G", mode="collaboration")
    img = add_image(g["id"], moderation_status="pending")
    assert admin_client.get(f"/api/public/g/{g['share_token']}/images").json() == []
    assert admin_client.post(f"/api/galleries/{g['id']}/images/{img}/approve").status_code == 200
    assert len(admin_client.get(f"/api/public/g/{g['share_token']}/images").json()) == 1
