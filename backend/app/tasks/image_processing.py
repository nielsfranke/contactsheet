# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import io
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from PIL import IptcImagePlugin
from PIL import Image as PilImage
from PIL.ExifTags import TAGS

from app.config import settings
from app.storage import format_detect, psd_thumbnail
from app.storage.local import LocalStorage

logger = logging.getLogger(__name__)

# Second-layer bomb guard: even if a pixel buffer is touched before our explicit dimension check,
# Pillow raises DecompressionBombError past this ceiling instead of allocating unbounded memory.
PilImage.MAX_IMAGE_PIXELS = settings.max_image_pixels

_EXIF_FIELDS = {
    "Make", "Model", "LensModel", "FocalLength", "FNumber",
    "ExposureTime", "ISOSpeedRatings", "DateTimeOriginal",
    "GPSLatitude", "GPSLongitude",
}

# IPTC-IIM datasets (record 2) → our response keys. Editorial/descriptive metadata
# the photographer writes in Lightroom/Photoshop/Bridge. `keywords` is repeatable.
_IPTC_FIELDS = {
    (2, 5): "title",        # Object Name
    (2, 105): "headline",
    (2, 120): "description",  # Caption/Abstract
    (2, 25): "keywords",    # repeatable
    (2, 80): "creator",     # By-line
    (2, 116): "copyright",
    (2, 110): "credit",
    (2, 90): "city",
    (2, 95): "state",       # Province/State
    (2, 101): "country",    # Country/Primary Location Name
}


def _decode_iptc(value: bytes) -> str:
    try:
        return value.decode("utf-8").strip()
    except (UnicodeDecodeError, AttributeError):
        try:
            return value.decode("latin-1").strip()
        except Exception:
            return ""


def _extract_iptc(img: PilImage.Image) -> dict | None:
    try:
        info = IptcImagePlugin.getiptcinfo(img)
        if not info:
            return None
        result: dict = {}
        for key, name in _IPTC_FIELDS.items():
            raw = info.get(key)
            if raw is None:
                continue
            if isinstance(raw, list):
                values = [s for s in (_decode_iptc(v) for v in raw) if s]
                if values:
                    result[name] = values
            else:
                s = _decode_iptc(raw)
                if s:
                    result[name] = s
        return result or None
    except Exception:
        return None


def preview_targets(high_res: bool) -> dict[str, tuple[int, int]]:
    """Rendition targets per app_settings.high_res_previews: variant dir → (long edge px, JPEG quality).

    The low-res set matches what older installs generated; the high-res set is env-configurable.
    `small` is the intermediate tier the lightbox shows on phones/tablets (so they don't pull the
    full `medium`); the browser picks it via srcset.
    """
    if high_res:
        return {"thumb": (settings.thumb_size, 82), "small": (1280, 86), "medium": (settings.medium_size, 88)}
    return {"thumb": (300, 82), "small": (1024, 86), "medium": (1920, 88)}


def _extract_exif(img: PilImage.Image) -> dict | None:
    try:
        raw = img._getexif()  # type: ignore[attr-defined]
        if not raw:
            return None
        result = {}
        for tag_id, value in raw.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag not in _EXIF_FIELDS:
                continue
            # Convert tuples/rationals to plain Python types
            if hasattr(value, "numerator"):
                value = float(value)
            elif isinstance(value, tuple):
                value = [float(v) if hasattr(v, "numerator") else v for v in value]
            elif isinstance(value, bytes):
                continue  # skip binary blobs
            result[str(tag)] = value
        return result or None
    except Exception:
        return None


def _open_source(original_path: str, stored_filename: str) -> PilImage.Image:
    """Open an upload as a Pillow image for rendition generation.

    Pillow-native stills (jpeg/png/webp/tiff/psd) open directly. Camera RAW is decoded *only* via
    its embedded JPEG preview (``rawpy.extract_thumb``) — no sensor demosaic, so it's fast and
    bounded in memory; the camera's own rendering is also what a client expects to see. RAW files
    with no embedded preview raise (the worker marks the image errored — full demosaic is Phase 2).
    """
    if not format_detect.is_raw_filename(stored_filename):
        return PilImage.open(original_path)

    import rawpy

    with rawpy.imread(original_path) as raw:
        thumb = raw.extract_thumb()
    if thumb.format == rawpy.ThumbFormat.JPEG:
        return PilImage.open(io.BytesIO(thumb.data))
    # Some bodies embed a raw bitmap thumbnail instead of a JPEG.
    return PilImage.fromarray(thumb.data)


def _auto_rotate(img: PilImage.Image) -> PilImage.Image:
    try:
        from PIL import ImageOps
        return ImageOps.exif_transpose(img)
    except Exception:
        return img


def _save_resized(
    img: PilImage.Image,
    max_px: int,
    dest_path: str,
    quality: int,
) -> None:
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    copy = img.copy()
    if copy.mode in ("RGBA", "P", "LA"):
        bg = PilImage.new("RGB", copy.size, (255, 255, 255))
        if copy.mode == "P":
            copy = copy.convert("RGBA")
        bg.paste(copy, mask=copy.split()[-1] if copy.mode in ("RGBA", "LA") else None)
        copy = bg
    elif copy.mode != "RGB":
        copy = copy.convert("RGB")

    if max(copy.size) > max_px:
        copy.thumbnail((max_px, max_px), PilImage.LANCZOS)

    # progressive=True so the browser paints the whole frame coarse→sharp instead of scanning
    # top-to-bottom (baseline), which looked like the photo "loading from the top" in the lightbox.
    copy.save(dest_path, "JPEG", quality=quality, optimize=True, progressive=True)


# Shared pool for rendition generation. Replaces FastAPI BackgroundTasks (which run serially in the
# request's thread after the response) so a batch upload renders several images at once. Each task
# opens its own DB session, so the pool is safe; busy_timeout (see database.py) absorbs the brief
# write contention when several finish together.
_executor = ThreadPoolExecutor(max_workers=settings.image_workers, thread_name_prefix="img-proc")


def submit_image_processing(image_id: str, gallery_id: str, stored_filename: str) -> None:
    """Enqueue thumb/small/medium generation on the worker pool (returns immediately)."""
    _executor.submit(process_image, image_id, gallery_id, stored_filename)


def process_image(image_id: str, gallery_id: str, stored_filename: str) -> None:
    """Worker task: generate thumb + small + medium renditions, then update the DB record."""
    from app.database import SessionLocal
    from app.repositories import image_repo, settings_repo

    storage = LocalStorage(base_dir=settings.upload_dir)
    original_path = os.path.join(settings.upload_dir, gallery_id, "original", stored_filename)

    db = SessionLocal()
    try:
        # Videos have no Pillow pipeline; nothing to render. (Upload normally skips
        # enqueuing this, but guard anyway so a stray call can't crash on a video.)
        image = image_repo.get_by_id(db, image_id)
        if image is not None and image.is_video:
            return

        targets = preview_targets(settings_repo.get(db).high_res_previews)

        is_psb = format_detect.is_psb_filename(stored_filename)
        if is_psb:
            # PSB preview comes from the embedded thumbnail (read from the file header — never the
            # multi-GB image data). No thumbnail (saved without "Maximize Compatibility") → store it
            # as a download-only asset with no renditions ("no_preview").
            data = psd_thumbnail.extract_thumbnail(original_path)
            if data is None:
                image_repo.update_processing_result(
                    db, image_id, width=None, height=None,
                    exif_data=None, iptc_data=None, status="no_preview",
                )
                image_repo.set_embedding_status(db, image_id, "skipped")
                from app.realtime import publish as realtime_publish
                realtime_publish(gallery_id, "image", image_id=image_id)
                logger.info("Stored PSB without preview: %s", image_id)
                return
            img = PilImage.open(io.BytesIO(data))
        else:
            img = _open_source(original_path, stored_filename)
        # Decompression-bomb / giant-dimension guard: reject on the header-declared dimensions
        # before any pixel buffer is allocated (img.copy()/thumbnail in _save_resized). A crafted
        # highly-compressible file can be tiny on disk yet huge in memory; bail early → status error.
        # Client (public) uploads get the stricter ceiling since that path is attacker-reachable.
        max_pixels = settings.max_image_pixels
        if image is not None and image.uploaded_by:
            max_pixels = min(max_pixels, settings.client_upload_max_pixels)
        w, h = img.size
        if w * h > max_pixels:
            raise ValueError(f"Image exceeds the {max_pixels}px area limit ({w}x{h})")
        # Read metadata from the as-opened image: exif_transpose() (in _auto_rotate) returns a
        # plain transposed copy that no longer carries _getexif / IPTC, so extracting after the
        # rotate silently dropped all EXIF and IPTC.
        exif_dict = _extract_exif(img) if hasattr(img, "_getexif") else None
        # ensure_ascii=False stores literal UTF-8 so non-ASCII IPTC values (umlauts in keywords,
        # places, names) survive as real characters — the "All Photos" filter substring-matches the
        # extracted JSON, and SQLite's json_extract of an *array* otherwise keeps \uXXXX escapes.
        exif_json = json.dumps(exif_dict, ensure_ascii=False) if exif_dict else None
        iptc_dict = _extract_iptc(img)
        iptc_json = json.dumps(iptc_dict, ensure_ascii=False) if iptc_dict else None
        img = _auto_rotate(img)
        width, height = img.size

        for variant, (max_px, quality) in targets.items():
            variant_path = os.path.join(settings.upload_dir, gallery_id, variant, stored_filename)
            _save_resized(img, max_px, variant_path, quality=quality)

        image_repo.update_processing_result(
            db,
            image_id,
            width=width,
            height=height,
            exif_data=exif_json,
            iptc_data=iptc_json,
            status="done",
        )
        # Live-update any open gallery view now that thumb/medium exist (esp. client uploads).
        from app.realtime import publish as realtime_publish
        realtime_publish(gallery_id, "image", image_id=image_id)
        logger.info("Processed image %s (%dx%d)", image_id, width, height)

        # Queue semantic-search indexing now that renditions exist (no-op unless enabled). PSB is
        # excluded from search (the embedded thumbnail is too small to give a useful vector).
        if is_psb:
            image_repo.set_embedding_status(db, image_id, "skipped")
        else:
            from app.tasks.embed_task import submit as submit_embedding
            submit_embedding(image_id)
    except Exception:
        logger.exception("Failed to process image %s", image_id)
        image_repo.set_processing_error(db, image_id)
    finally:
        db.close()
