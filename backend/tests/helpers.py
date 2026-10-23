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


def psd16_bytes(color=(200, 100, 50), size=(6, 4), *, mode=3, rle=True, depth=16,
                thumbnail=False, icc: bytes | None = None) -> bytes:
    """A minimal 16-bit PSD (8BPS v1) with a flat composite of one colour — the depth Pillow can't open.

    ``mode`` is the Photoshop colour mode (1 gray, 3 RGB, 4 CMYK — stored inverted, as Photoshop
    does). ``rle`` picks PackBits vs raw composite data; ``depth`` lets a test build an unsupported
    (e.g. 32-bit) file; ``thumbnail`` adds the 1036 JPEG resource the worker falls back to."""
    w, h = size
    channels = {1: 1, 3: 3, 4: 4}[mode]
    values = list(color)[:channels]
    if mode == 4:
        values = [255 - v for v in values]
    header = (
        b"8BPS" + b"\x00\x01" + b"\x00" * 6
        + struct.pack(">HIIHH", channels, h, w, depth, mode)
    )
    resources = b""
    if icc:
        resources += b"8BIM" + struct.pack(">H", 1039) + b"\x00\x00" + struct.pack(">I", len(icc)) + icc
        if len(icc) % 2:
            resources += b"\x00"
    if thumbnail:
        resources += psb_bytes(with_thumbnail=True)[34:]  # reuse the PSB builder's 1036 resource
    sample = 2 if depth == 16 else depth // 8
    rows = [[struct.pack(">H", v * 257) * w if depth == 16 else bytes(sample * w)] for v in values]
    if rle:
        # PackBits literal runs (header n → n+1 literal bytes), at most 128 bytes per run.
        def packbits(row: bytes) -> bytes:
            return b"".join(bytes([len(c) - 1]) + c for c in (row[i:i + 128] for i in range(0, len(row), 128)))
        encoded = [packbits(r[0]) for r in rows]
        counts = b"".join(struct.pack(">H", len(e)) * h for e in encoded)
        image_data = struct.pack(">H", 1) + counts + b"".join(e * h for e in encoded)
    else:
        image_data = struct.pack(">H", 0) + b"".join(r[0] * h for r in rows)
    return (
        header + struct.pack(">I", 0) + struct.pack(">I", len(resources)) + resources
        + struct.pack(">I", 0) + image_data
    )


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
