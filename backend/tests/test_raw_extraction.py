# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Live camera-RAW extraction — the rawpy embedded-preview path.

RAW files are large (MBs) so none are committed. This test is **fixture-gated**: point
``CONTACTSHEET_RAW_FIXTURES`` at a directory of real raws and it exercises the actual pipeline
(detect → extract embedded preview → JPEG rendition). It skips otherwise, keeping CI binary-free.

Free CC0 samples to populate the dir: https://raw.pixls.us/ (e.g. one .cr3/.nef/.arw/.raf/.dng).
"""

import glob
import os

import pytest

from app.storage import format_detect

FIXTURE_DIR = os.environ.get("CONTACTSHEET_RAW_FIXTURES")
_raws = sorted(glob.glob(os.path.join(FIXTURE_DIR, "*"))) if FIXTURE_DIR else []


@pytest.mark.skipif(not _raws, reason="set CONTACTSHEET_RAW_FIXTURES to a dir of raw files")
@pytest.mark.parametrize("path", _raws, ids=[os.path.basename(p) for p in _raws])
def test_raw_detected_and_renders(path, tmp_path):
    from app.tasks.image_processing import _open_source, _save_resized

    name = os.path.basename(path)
    with open(path, "rb") as f:
        header = f.read(32)

    fmt = format_detect.detect_format(header, name)
    assert fmt is not None and fmt.kind == "raw", f"{name} not detected as raw: {fmt}"

    # Extract the embedded preview and produce a real JPEG rendition.
    img = _open_source(path, name)
    assert img.size[0] > 0 and img.size[1] > 0
    out = tmp_path / "thumb.jpg"
    _save_resized(img, 300, str(out), 82)
    assert out.exists() and out.stat().st_size > 0
