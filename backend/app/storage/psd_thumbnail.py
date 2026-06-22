# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Extract the embedded thumbnail from a PSD/PSB file — without decoding the image.

Photoshop embeds a small JPEG preview (image-resource id 1036, or the older 1033) when "Maximize
Compatibility" is on. It lives in the **image resources** block, which sits near the *start* of the
file — before the multi-GB image-data section. So this reads only the header + resources and never
touches the full composite, making PSB previews effectively free (no decode, no ImageMagick).

PSD and PSB share this layout: the color-mode-data and image-resources lengths are both 4-byte
fields in *both* formats (only the layer/mask and image-data sections use 8-byte lengths in PSB),
so the same parser handles either. Returns the JPEG bytes, or ``None`` when no thumbnail is present.
"""

from __future__ import annotations

import logging
import struct

logger = logging.getLogger(__name__)

# Cap how much of the resources block we'll scan — it's normally well under this; the guard stops a
# malformed/oversized length from making us read an unbounded amount.
_MAX_RESOURCES_BYTES = 8 * 1024 * 1024

_THUMBNAIL_RESOURCE_IDS = (1036, 1033)  # 1036 = JPEG RGB, 1033 = older JPEG BGR
# Thumbnail resource payload: format(4) + width(4) + height(4) + widthbytes(4) + totalsize(4)
# + compressedsize(4) + bitspixel(2) + planes(2) = 28 bytes, then the JPEG data.
_THUMB_HEADER_LEN = 28


def extract_thumbnail(path: str) -> bytes | None:
    """Return the embedded thumbnail JPEG bytes from a PSD/PSB, or None if there isn't one."""
    try:
        with open(path, "rb") as f:
            header = f.read(26)
            if len(header) < 26 or header[:4] != b"8BPS":
                return None
            # header: signature(4) version(2) reserved(6) channels(2) height(4) width(4) depth(2) mode(2)

            # Color Mode Data: 4-byte length, then skip it.
            cmd_len_raw = f.read(4)
            if len(cmd_len_raw) < 4:
                return None
            (cmd_len,) = struct.unpack(">I", cmd_len_raw)
            f.seek(cmd_len, 1)

            # Image Resources: 4-byte length, then the block (bounded read).
            res_len_raw = f.read(4)
            if len(res_len_raw) < 4:
                return None
            (res_len,) = struct.unpack(">I", res_len_raw)
            if res_len == 0:
                return None
            block = f.read(min(res_len, _MAX_RESOURCES_BYTES))

        return _find_thumbnail(block)
    except (OSError, struct.error):
        logger.debug("PSD/PSB thumbnail extraction failed for %s", path, exc_info=True)
        return None


def _find_thumbnail(block: bytes) -> bytes | None:
    """Walk the image-resources block for a thumbnail resource and return its JPEG bytes."""
    pos = 0
    n = len(block)
    while pos + 8 <= n:
        if block[pos:pos + 4] != b"8BIM":
            break  # not aligned on a resource — give up rather than scan garbage
        pos += 4
        (resource_id,) = struct.unpack(">H", block[pos:pos + 2])
        pos += 2
        # Pascal name: length byte + name, padded to an even total length.
        name_len = block[pos]
        name_field = 1 + name_len
        if name_field % 2:
            name_field += 1
        pos += name_field
        if pos + 4 > n:
            break
        (size,) = struct.unpack(">I", block[pos:pos + 4])
        pos += 4
        data = block[pos:pos + size]
        if resource_id in _THUMBNAIL_RESOURCE_IDS and len(data) > _THUMB_HEADER_LEN:
            jpeg = data[_THUMB_HEADER_LEN:]
            if jpeg[:3] == b"\xff\xd8\xff":  # only the JPEG variants; ignore raw-RGB thumbnails
                return jpeg
        pos += size + (size % 2)  # resource data is padded to even length
    return None
