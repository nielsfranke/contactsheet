# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Content-sniffing format detection (detect_format) — the upload acceptance gate."""

from app.storage import format_detect


def _detect(header: bytes, name: str):
    return format_detect.detect_format(header, name)


# --- Pillow-native stills ---------------------------------------------------------------------

def test_jpeg():
    f = _detect(b"\xff\xd8\xff\xe0", "x.jpg")
    assert f and f.key == "jpeg" and f.kind == "image" and f.ext == ".jpg"


def test_png():
    f = _detect(b"\x89PNG\r\n\x1a\n", "x.png")
    assert f and f.key == "png" and f.kind == "image"


def test_webp():
    f = _detect(b"RIFF" + b"size" + b"WEBP", "x.webp")
    assert f and f.key == "webp" and f.kind == "image"


def test_tiff_le_and_be():
    for magic in (b"II*\x00", b"MM\x00*"):
        f = _detect(magic + b"\x00" * 8, "scan.tiff")
        assert f and f.key == "tiff" and f.kind == "image" and f.ext == ".tif"


def test_psd_accepted():
    f = _detect(b"8BPS\x00\x01" + b"\x00" * 8, "art.psd")
    assert f and f.key == "psd" and f.kind == "image"


# --- PSB is accepted (preview from the embedded thumbnail; see psd_thumbnail) ------------------

def test_psb_accepted_as_psb_kind():
    f = _detect(b"8BPS\x00\x02" + b"\x00" * 8, "huge.psb")
    assert f and f.key == "psb" and f.kind == "psb" and f.ext == ".psb"


# --- Camera RAW -------------------------------------------------------------------------------

def test_tiff_based_raw_disambiguated_by_extension():
    # CR2/NEF/ARW/DNG share the TIFF magic; the extension routes them to raw, not tiff.
    for name, want_ext in [("a.cr2", ".cr2"), ("b.nef", ".nef"), ("c.dng", ".dng")]:
        f = _detect(b"II*\x00" + b"\x00" * 8, name)
        assert f and f.kind == "raw" and f.ext == want_ext


def test_tiff_magic_unknown_extension_rejected():
    # Same TIFF magic but neither a real .tiff nor a known raw extension → reject.
    assert _detect(b"II*\x00" + b"\x00" * 8, "mystery.bin") is None


def test_fuji_raf():
    f = _detect(b"FUJIFILMCCD-RAW" + b"\x00", "shot.raf")
    assert f and f.kind == "raw" and f.ext == ".raf"


def test_panasonic_rw2_and_olympus_orf():
    assert (_detect(b"IIU\x00" + b"\x00" * 8, "p.rw2") or None) and \
        _detect(b"IIU\x00" + b"\x00" * 8, "p.rw2").kind == "raw"
    f = _detect(b"IIRO" + b"\x00" * 8, "o.orf")
    assert f and f.kind == "raw" and f.ext == ".orf"


def test_canon_cr3_brand():
    header = b"\x00\x00\x00\x18ftyp" + b"crx " + b"\x00" * 8
    f = _detect(header, "z.cr3")
    assert f and f.kind == "raw" and f.ext == ".cr3"


def test_raw_falls_back_to_family_extension_when_name_lacks_one():
    header = b"\x00\x00\x00\x18ftyp" + b"crx " + b"\x00" * 8
    f = _detect(header, "noext")
    assert f and f.kind == "raw" and f.ext == ".cr3"


# --- Video ------------------------------------------------------------------------------------

def test_mp4_and_mov_and_webm():
    mp4 = _detect(b"\x00\x00\x00\x18ftyp" + b"isom" + b"\x00" * 8, "v.mp4")
    assert mp4 and mp4.kind == "video" and mp4.key == "mp4"
    mov = _detect(b"\x00\x00\x00\x18ftyp" + b"qt  " + b"\x00" * 8, "v.mov")
    assert mov and mov.kind == "video" and mov.key == "mov"
    webm = _detect(b"\x1aE\xdf\xa3" + b"\x00" * 8, "v.webm")
    assert webm and webm.kind == "video" and webm.key == "webm"


# --- Unknown ----------------------------------------------------------------------------------

def test_unknown_bytes_rejected():
    assert _detect(b"%PDF-1.4 fake", "x.pdf") is None
    assert _detect(b"random noise here", "x.png") is None


# --- Worker routing helpers -------------------------------------------------------------------

def test_routing_helpers():
    assert format_detect.is_raw_filename("abc.cr2") is True
    assert format_detect.is_raw_filename("abc.jpg") is False
    assert format_detect.is_pillow_filename("abc.tif") is True
    assert format_detect.is_pillow_filename("abc.cr2") is False
