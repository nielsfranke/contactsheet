# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Content-sniffing file-format detection for uploads.

Acceptance is keyed off the file's **actual bytes** (magic) + extension, not the browser-supplied
``content_type`` — browsers send unreliable/empty MIME for TIFF, PSD and camera RAW. Each accepted
format maps to a canonical stored extension, a stored ``mime_type`` string, and a ``kind`` that
drives the pipeline:

- ``image``  — Pillow opens it directly (jpeg/png/webp/tiff/psd).
- ``raw``    — camera raw; the rendition worker extracts the embedded JPEG preview (see
  ``tasks/image_processing``). Stored extension keeps the real raw extension so the delivered
  original opens in the right app.
- ``video``  — stored as-is, no Pillow pipeline.
- ``reject_psb`` — Photoshop *large-document* (.psb): detected so the caller can return a specific
  error. Pillow can't read it; full support is Phase 2 (a convert sidecar).

``detect_format`` never trusts the extension alone: the magic must match. The extension only
*disambiguates* the many TIFF-based raws (.cr2/.nef/.arw/.dng…) from a real .tiff, since they share
the TIFF magic.
"""

from __future__ import annotations

from dataclasses import dataclass

# Camera-raw extensions. Most are TIFF-based (share the TIFF magic); a few carry their own magic
# (RAF/RW2/ORF/CR3) and are matched directly below.
RAW_EXTS = {
    ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".sr2", ".srf", ".dng", ".raf", ".orf",
    ".rw2", ".pef", ".srw", ".rwl", ".dcr", ".kdc", ".mrw", ".x3f", ".3fr", ".mef", ".iiq",
}

# Pillow-openable still extensions (used to route the rendition worker).
_PILLOW_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".psd"}

# Originals the ML sidecar (plain Pillow) cannot reliably read: camera RAW (not at all) and PSD
# (only a fragile composite). For these, semantic-search indexing must use the generated JPEG
# rendition instead of the original — see embed_task.
_ML_UNREADABLE_ORIGINAL_EXTS = RAW_EXTS | {".psd", ".psb"}


@dataclass(frozen=True)
class Format:
    key: str       # canonical id: jpeg/png/webp/tiff/psd/raw/mp4/mov/webm/psb
    ext: str       # canonical stored extension (raw keeps its real extension)
    mime: str      # value stored in images.mime_type (informational; is_video is the real gate)
    kind: str      # "image" | "raw" | "video" | "reject_psb"


def _ext_of(filename: str) -> str:
    name = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    i = name.rfind(".")
    return name[i:].lower() if i >= 0 else ""


def _raw(ext_from_name: str, default_ext: str) -> Format:
    ext = ext_from_name if ext_from_name in RAW_EXTS else default_ext
    return Format("raw", ext, "image/x-raw", "raw")


def detect_format(header: bytes, filename: str) -> Format | None:
    """Return the detected ``Format`` for ``header`` (first ~32 bytes) + ``filename``.

    ``None`` means unsupported. A ``reject_psb`` result is a *known* format the caller should reject
    with a dedicated message rather than the generic "unsupported".
    """
    h = header
    ext = _ext_of(filename)

    if h[:3] == b"\xff\xd8\xff":
        return Format("jpeg", ".jpg", "image/jpeg", "image")
    if h[:8] == b"\x89PNG\r\n\x1a\n":
        return Format("png", ".png", "image/png", "image")
    if h[:4] == b"RIFF" and h[8:12] == b"WEBP":
        return Format("webp", ".webp", "image/webp", "image")

    # Photoshop: '8BPS' + version word (1 = PSD, 2 = PSB).
    if h[:4] == b"8BPS":
        ver = h[4:6]
        if ver == b"\x00\x01":
            return Format("psd", ".psd", "image/vnd.adobe.photoshop", "image")
        if ver == b"\x00\x02":
            return Format("psb", ".psb", "image/vnd.adobe.photoshop", "reject_psb")
        return None

    # Fujifilm RAF carries its own ASCII magic.
    if h[:15] == b"FUJIFILMCCD-RAW":
        return _raw(ext, ".raf")
    # Panasonic RW2 and Olympus ORF use TIFF-like custom magics.
    if h[:4] in (b"IIU\x00", b"II\x55\x00"):
        return _raw(ext, ".rw2")
    if h[:4] in (b"IIRO", b"IIRS", b"MMOR"):
        return _raw(ext, ".orf")

    # Standard TIFF magic — shared by real TIFFs and most TIFF-based raws (CR2/NEF/ARW/DNG/…).
    # Disambiguate by extension.
    if h[:4] in (b"II*\x00", b"MM\x00*"):
        if ext in (".tif", ".tiff"):
            return Format("tiff", ".tif", "image/tiff", "image")
        if ext in RAW_EXTS:
            return _raw(ext, ext)
        return None

    # ISO-BMFF: 'ftyp' box at offset 4. Canon CR3 raw uses brand 'crx '; otherwise it's video.
    if h[4:8] == b"ftyp":
        brand = h[8:12]
        if brand == b"crx ":
            return _raw(ext, ".cr3")
        if brand == b"qt  ":
            return Format("mov", ".mov", "video/quicktime", "video")
        return Format("mp4", ".mp4", "video/mp4", "video")
    # Matroska/WebM (EBML).
    if h[:4] == b"\x1aE\xdf\xa3":
        return Format("webm", ".webm", "video/webm", "video")

    return None


def is_raw_filename(stored_filename: str) -> bool:
    """Whether a stored file is camera raw (drives embedded-preview extraction in the worker)."""
    return _ext_of(stored_filename) in RAW_EXTS


def is_pillow_filename(stored_filename: str) -> bool:
    """Whether a stored file is opened directly by Pillow (jpeg/png/webp/tiff/psd)."""
    return _ext_of(stored_filename) in _PILLOW_EXTS


def ml_can_read_original(stored_filename: str) -> bool:
    """Whether the ML sidecar (plain Pillow) can read this file's *original* for embedding.

    False for camera RAW and PSD — those must be indexed from the JPEG rendition instead.
    """
    return _ext_of(stored_filename) not in _ML_UNREADABLE_ORIGINAL_EXTS
