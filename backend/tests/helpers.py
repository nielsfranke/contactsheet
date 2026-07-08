# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Small builders shared across the test suite."""

import io
import struct
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


def jpeg_bytes(color=(10, 20, 30), size=(8, 8)) -> bytes:
    buf = io.BytesIO()
    PilImage.new("RGB", size, color).save(buf, format="JPEG")
    return buf.getvalue()


def big_jpeg_bytes(side=3000) -> bytes:
    """A real, decodable JPEG whose encoded size exceeds the generic 10 MB read_limited default.

    High-frequency noise barely compresses, so a 3000² JPEG at top quality lands well past 10 MB —
    enough to prove header/cover uploads use their own, larger byte cap. Stays under max_image_pixels."""
    import os

    img = PilImage.frombytes("RGB", (side, side), os.urandom(side * side * 3))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=100, subsampling=0)
    return buf.getvalue()


def psb_bytes(with_thumbnail: bool = True) -> bytes:
    """A minimal valid PSB (8BPS v2) — header + color-mode + image-resources, no image data.

    With ``with_thumbnail`` it carries an image-resource 1036 wrapping a real JPEG (the path our
    extractor reads); without it, the resources block is empty (the "no preview" fallback). The
    image-data section is omitted on purpose: nothing in our pipeline reads past the resources.
    """
    header = (
        b"8BPS" + b"\x00\x02" + b"\x00" * 6
        + struct.pack(">H", 3)        # channels
        + struct.pack(">I", 16)       # height
        + struct.pack(">I", 16)       # width
        + struct.pack(">H", 8)        # depth
        + struct.pack(">H", 3)        # mode = RGB
    )
    color_mode = struct.pack(">I", 0)

    resources = b""
    if with_thumbnail:
        jpeg = jpeg_bytes()
        thumb_header = (
            struct.pack(">I", 1)              # format = kJpegRGB
            + struct.pack(">I", 16) + struct.pack(">I", 16)  # width, height
            + struct.pack(">I", 16 * 3)      # widthbytes
            + struct.pack(">I", len(jpeg)) + struct.pack(">I", len(jpeg))  # total, compressed
            + struct.pack(">H", 24) + struct.pack(">H", 1)   # bits/pixel, planes
        )
        data = thumb_header + jpeg
        resources = b"8BIM" + struct.pack(">H", 1036) + b"\x00\x00" + struct.pack(">I", len(data)) + data
        if len(data) % 2:
            resources += b"\x00"  # resource data is padded to even length

    return header + color_mode + struct.pack(">I", len(resources)) + resources


def add_image(gallery_id: str, *, status="done", filename="photo.jpg", sort_order=0,
              moderation_status="approved", uploaded_by=None, is_video=False) -> str:
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
            mime_type="video/mp4" if is_video else "image/jpeg",
            is_video=is_video,
            sort_order=sort_order,
            processing_status=status,
            moderation_status=moderation_status,
            uploaded_by=uploaded_by,
        )
        return img.id
    finally:
        db.close()
