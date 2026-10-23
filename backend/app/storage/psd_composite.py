# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Read the merged composite of a 16-bit PSD — the depth Pillow's PSD plugin can't open.

Pillow only maps 1- and 8-bit PSDs (``PsdImagePlugin.MODES``); a 16-bit file — the normal export
depth for retouched photos — raises ``UnidentifiedImageError``. Photoshop always writes the
flattened composite as the *last* section of the file (raw or PackBits per channel, big-endian
samples), so we skip the header sections, decode each colour channel with Pillow's own C decoders
(rawmode ``L;16B`` keeps the high byte → 8-bit) and merge the bands. Extra channels (alpha, spot)
are ignored; previews are flattened anyway.

Handles PSD (v1) in Grayscale / RGB / CMYK at 16 bit with raw or RLE composites. Anything else
(32-bit HDR, Lab, ZIP-compressed composite) returns ``None`` and the caller falls back to the
embedded thumbnail.
"""

from __future__ import annotations

import logging
import struct

from PIL import Image as PilImage
from PIL import ImageOps

logger = logging.getLogger(__name__)

# Photoshop colour mode → (Pillow band mode, colour channels needed).
_MODES = {1: ("L", 1), 3: ("RGB", 3), 4: ("CMYK", 4)}
_ICC_RESOURCE_ID = 1039


def open_composite(path: str, max_pixels: int) -> PilImage.Image | None:
    """Decode a 16-bit PSD's composite to an 8-bit Pillow image, or None if unsupported.

    ``max_pixels`` is checked on the header dimensions *before* any pixel buffer is allocated
    (the same decompression-bomb guard ``process_image`` applies to Pillow-opened files)."""
    try:
        with open(path, "rb") as f:
            header = f.read(26)
            if len(header) < 26 or header[:4] != b"8BPS":
                return None
            version, = struct.unpack(">H", header[4:6])
            channels, height, width, depth, color_mode = struct.unpack(">HIIHH", header[12:26])
            if version != 1 or depth != 16 or color_mode not in _MODES:
                return None
            mode, needed = _MODES[color_mode]
            if channels < needed or width == 0 or height == 0:
                return None
            if width * height > max_pixels:
                raise ValueError(f"Image exceeds the {max_pixels}px area limit ({width}x{height})")

            (cmd_len,) = struct.unpack(">I", f.read(4))
            f.seek(cmd_len, 1)
            (res_len,) = struct.unpack(">I", f.read(4))
            icc = _find_icc(f.read(res_len))
            (layers_len,) = struct.unpack(">I", f.read(4))
            f.seek(layers_len, 1)

            (compression,) = struct.unpack(">H", f.read(2))
            row_bytes = width * 2
            bands = []
            if compression == 0:
                for _ in range(needed):
                    bands.append(_decode(f.read(row_bytes * height), "raw", width, height))
            elif compression == 1:
                # Byte counts for every row of *every* channel come first (2 bytes each in PSD).
                counts = struct.unpack(f">{channels * height}H", f.read(channels * height * 2))
                for c in range(needed):
                    size = sum(counts[c * height:(c + 1) * height])
                    bands.append(_decode(f.read(size), "packbits", width, height))
            else:
                return None  # ZIP composite — not written by Photoshop for the merged image
    except (OSError, struct.error):
        logger.debug("16-bit PSD composite read failed for %s", path, exc_info=True)
        return None

    if mode == "CMYK":
        bands = [ImageOps.invert(b) for b in bands]  # PSD stores CMYK inverted (0 = full ink)
    img = bands[0] if mode == "L" else PilImage.merge(mode, bands)
    if icc:
        img.info["icc_profile"] = icc
    return img


def _decode(data: bytes, codec: str, width: int, height: int) -> PilImage.Image:
    """One 16-bit big-endian channel → an 8-bit ``L`` band (high byte), via Pillow's C decoder."""
    band = PilImage.new("L", (width, height))
    decoder = PilImage._getdecoder("L", codec, "L;16B")
    decoder.setimage(band.im, (0, 0, width, height))
    # Pillow's decoder returns consumed=-1 once the band is full; >= 0 means it wants more data.
    consumed, err = decoder.decode(data)
    if err < 0 or consumed >= 0:
        raise OSError(f"{codec} decode failed or truncated ({err})")
    return band


def _find_icc(block: bytes) -> bytes | None:
    """The embedded ICC profile (image resource 1039) from the image-resources block, if any."""
    pos, n = 0, len(block)
    while pos + 12 <= n and block[pos:pos + 4] == b"8BIM":
        (resource_id,) = struct.unpack(">H", block[pos + 4:pos + 6])
        name_field = 1 + block[pos + 6]
        pos += 6 + name_field + (name_field % 2)
        (size,) = struct.unpack(">I", block[pos:pos + 4])
        pos += 4
        if resource_id == _ICC_RESOURCE_ID:
            return block[pos:pos + size]
        pos += size + (size % 2)
    return None
