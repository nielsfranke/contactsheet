# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Colour management: renditions are written and tagged as sRGB so wide-gamut sources (Adobe RGB,
ProPhoto, Display-P3) don't display desaturated in browsers (which assume sRGB for untagged JPEGs)."""

import io
import os

from PIL import Image, ImageCms

from app.config import settings
from app.database import SessionLocal
from app.repositories import image_repo
from app.tasks.image_processing import _to_srgb, original_needs_srgb

from .helpers import make_gallery, png_bytes


def _srgb_bytes():
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def _lab_bytes():
    # A valid, non-sRGB profile that cannot build an RGB→sRGB transform — a stand-in for the
    # "weird/unsupported profile" path and a non-sRGB description for detection.
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("LAB")).tobytes()


def _upload(admin_client, gallery_id, data, name="p.png"):
    return admin_client.post(
        f"/api/galleries/{gallery_id}/images", files=[("files", (name, data, "image/png"))]
    )


def _stored(image_id):
    db = SessionLocal()
    try:
        return image_repo.get_by_id(db, image_id).stored_filename
    finally:
        db.close()


def _rendition_icc(gallery_id, tier, stored):
    with Image.open(os.path.join(settings.upload_dir, gallery_id, tier, stored)) as im:
        return im.info.get("icc_profile")


def test_renditions_are_srgb_tagged(admin_client):
    """Every rendition carries an sRGB ICC profile — the fix that stops wide-gamut photos from
    rendering desaturated (an untagged JPEG is assumed sRGB by browsers)."""
    g = make_gallery(admin_client, "G")
    img_id = _upload(admin_client, g["id"], png_bytes()).json()[0]["id"]
    stored = _stored(img_id)
    for tier in ("thumb", "small", "medium"):
        icc = _rendition_icc(g["id"], tier, stored)
        assert icc, f"{tier} rendition has no ICC profile"
        desc = ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(icc))).lower()
        assert "srgb" in desc, f"{tier} rendition not tagged sRGB: {desc!r}"


def test_to_srgb_noop_for_untagged_and_srgb():
    im = Image.new("RGB", (4, 4), (10, 20, 30))
    assert _to_srgb(im, None) is im                 # untagged → assumed sRGB, unchanged
    assert _to_srgb(im, _srgb_bytes()) is im         # already sRGB → no needless round-trip


def test_to_srgb_falls_back_on_cms_error():
    """An unsupported/broken profile must never crash or corrupt the image — return it as-is."""
    im = Image.new("RGB", (4, 4), (10, 20, 30))
    assert _to_srgb(im, _lab_bytes()) is im


def test_original_needs_srgb_detection(tmp_path):
    non_srgb = tmp_path / "lab.jpg"
    Image.new("RGB", (8, 8), (10, 20, 30)).save(non_srgb, "JPEG", icc_profile=_lab_bytes())
    assert original_needs_srgb(str(non_srgb)) is True

    srgb = tmp_path / "srgb.jpg"
    Image.new("RGB", (8, 8), (10, 20, 30)).save(srgb, "JPEG", icc_profile=_srgb_bytes())
    assert original_needs_srgb(str(srgb)) is False

    untagged = tmp_path / "plain.jpg"
    Image.new("RGB", (8, 8), (10, 20, 30)).save(untagged, "JPEG")
    assert original_needs_srgb(str(untagged)) is False
