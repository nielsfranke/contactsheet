# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Small builders shared across the test suite."""

import io
import uuid

from PIL import Image as PilImage

from app.database import SessionLocal
from app.repositories import image_repo


def make_gallery(admin_client, name="Gallery", parent_id=None, mode="presentation", **extra) -> dict:
    body = {"name": name, "parent_id": parent_id, "mode": mode, **extra}
    r = admin_client.post("/api/galleries", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def png_bytes(color=(120, 60, 200), size=(16, 16)) -> bytes:
    buf = io.BytesIO()
    PilImage.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def add_image(gallery_id: str, *, status="done", filename="photo.jpg", sort_order=0,
              moderation_status="approved", uploaded_by=None) -> str:
    """Insert an Image row directly (no processing pipeline). Returns its id."""
    db = SessionLocal()
    try:
        img = image_repo.create(
            db,
            id=str(uuid.uuid4()),
            gallery_id=gallery_id,
            original_filename=filename,
            stored_filename=f"{uuid.uuid4()}.jpg",
            file_size=1234,
            mime_type="image/jpeg",
            sort_order=sort_order,
            processing_status=status,
            moderation_status=moderation_status,
            uploaded_by=uploaded_by,
        )
        return img.id
    finally:
        db.close()
