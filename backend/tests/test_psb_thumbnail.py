# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""PSB embedded-thumbnail extraction (the lean preview path — no full decode)."""

import io

from PIL import Image as PilImage

from app.storage import psd_thumbnail

from .helpers import psb_bytes


def test_extracts_embedded_jpeg(tmp_path):
    path = tmp_path / "with.psb"
    path.write_bytes(psb_bytes(with_thumbnail=True))

    data = psd_thumbnail.extract_thumbnail(str(path))
    assert data is not None and data[:3] == b"\xff\xd8\xff"   # a JPEG
    # …and it's a real, openable image (this is what the worker hands the rendition step).
    img = PilImage.open(io.BytesIO(data))
    assert img.size[0] > 0 and img.size[1] > 0


def test_returns_none_without_thumbnail(tmp_path):
    path = tmp_path / "without.psb"
    path.write_bytes(psb_bytes(with_thumbnail=False))
    assert psd_thumbnail.extract_thumbnail(str(path)) is None


def test_returns_none_for_non_psd(tmp_path):
    path = tmp_path / "x.bin"
    path.write_bytes(b"not a photoshop file at all")
    assert psd_thumbnail.extract_thumbnail(str(path)) is None
