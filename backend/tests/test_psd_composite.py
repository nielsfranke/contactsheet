# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""16-bit PSD composite decoding (Pillow opens 8-bit PSDs only) + the worker's PSD fallback chain."""

import os
import uuid

import pytest
from PIL import Image as PilImage
from PIL import UnidentifiedImageError

from app.storage import psd_composite

from .helpers import make_gallery, psd16_bytes


def _write(tmp_path, data: bytes) -> str:
    path = tmp_path / "x.psd"
    path.write_bytes(data)
    return str(path)


def test_pillow_cannot_open_16_bit(tmp_path):
    # The bug this module exists for: guard that the fallback stays necessary (and the fixture real).
    with pytest.raises(UnidentifiedImageError):
        PilImage.open(_write(tmp_path, psd16_bytes()))


@pytest.mark.parametrize("rle", [True, False])
def test_decodes_rgb_composite(tmp_path, rle):
    img = psd_composite.open_composite(_write(tmp_path, psd16_bytes((200, 100, 50), rle=rle)), 10**6)
    assert img.mode == "RGB" and img.size == (6, 4)
    assert img.getpixel((5, 3)) == (200, 100, 50)


def test_decodes_cmyk_uninverted(tmp_path):
    img = psd_composite.open_composite(_write(tmp_path, psd16_bytes((10, 20, 30, 40), mode=4)), 10**6)
    assert img.mode == "CMYK" and img.getpixel((0, 0)) == (10, 20, 30, 40)


def test_decodes_grayscale(tmp_path):
    img = psd_composite.open_composite(_write(tmp_path, psd16_bytes((77,), mode=1)), 10**6)
    assert img.mode == "L" and img.getpixel((2, 2)) == 77


def test_carries_icc_profile(tmp_path):
    icc = b"fake-icc-profile"
    img = psd_composite.open_composite(_write(tmp_path, psd16_bytes(icc=icc)), 10**6)
    assert img.info["icc_profile"] == icc


def test_pixel_ceiling_checked_before_decode(tmp_path):
    with pytest.raises(ValueError):
        psd_composite.open_composite(_write(tmp_path, psd16_bytes(size=(6, 4))), 23)


def test_unsupported_depth_and_truncation_return_none(tmp_path):
    assert psd_composite.open_composite(_write(tmp_path, psd16_bytes(depth=32)), 10**6) is None
    assert psd_composite.open_composite(_write(tmp_path, psd16_bytes(depth=8)), 10**6) is None
    truncated = psd16_bytes(rle=False)[:-10]
    assert psd_composite.open_composite(_write(tmp_path, truncated), 10**6) is None


def _seed_psd(gallery_id: str, data: bytes) -> tuple[str, str]:
    from app.config import settings
    from app.database import SessionLocal
    from app.repositories import image_repo

    stored = f"{uuid.uuid4()}.psd"
    original_dir = os.path.join(settings.upload_dir, gallery_id, "original")
    os.makedirs(original_dir, exist_ok=True)
    with open(os.path.join(original_dir, stored), "wb") as f:
        f.write(data)
    db = SessionLocal()
    try:
        img = image_repo.create(
            db, id=str(uuid.uuid4()), gallery_id=gallery_id, original_filename="art.psd",
            stored_filename=stored, file_size=len(data), mime_type="image/vnd.adobe.photoshop",
            sort_order=0, processing_status="pending", moderation_status="approved",
        )
        return img.id, stored
    finally:
        db.close()


@pytest.mark.parametrize("data, status", [
    (psd16_bytes(size=(40, 30)), "done"),                     # 16-bit → own composite decoder
    (psd16_bytes(depth=32, thumbnail=True), "done"),          # unsupported → embedded thumbnail
    (psd16_bytes(depth=32), "no_preview"),                    # nothing readable → download-only
])
def test_worker_never_errors_on_psd(admin_client, data, status):
    from app.config import settings
    from app.database import SessionLocal
    from app.repositories import image_repo
    from app.tasks.image_processing import process_image

    g = make_gallery(admin_client, "PSD")
    image_id, stored = _seed_psd(g["id"], data)
    process_image(image_id, g["id"], stored)

    db = SessionLocal()
    try:
        assert image_repo.get_by_id(db, image_id).processing_status == status
    finally:
        db.close()
    thumb = os.path.join(settings.upload_dir, g["id"], "thumb", stored)
    assert os.path.exists(thumb) == (status == "done")
