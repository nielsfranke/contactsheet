# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import HTTPException, UploadFile, status

_10_MB = 10 * 1024 * 1024


def read_limited(file: UploadFile, max_bytes: int = _10_MB) -> bytes:
    data = file.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")
    return data


# Leading magic bytes for the raster formats accepted on admin branding/header/cover/watermark
# uploads. Those endpoints previously validated only the (client-controlled) Content-Type; a
# magic-byte check stops a spoofed type from smuggling a non-image (or a script-bearing payload)
# past a permissive extension.
_IMAGE_MAGIC = {
    "image/jpeg": lambda h: h[:3] == b"\xff\xd8\xff",
    "image/png": lambda h: h[:8] == b"\x89PNG\r\n\x1a\n",
    "image/webp": lambda h: h[:4] == b"RIFF" and h[8:12] == b"WEBP",
}


def assert_image_magic(data: bytes, mime: str) -> None:
    """Raise 415 if ``data`` doesn't begin with the magic bytes for ``mime``. Unknown mimes pass
    (the caller's allow-list governs which types reach here)."""
    check = _IMAGE_MAGIC.get(mime)
    if check and not check(data[:12]):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File content does not match its declared type",
        )
