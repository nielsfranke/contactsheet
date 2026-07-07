# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import io
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor

from PIL import IptcImagePlugin
from PIL import Image as PilImage
from PIL.ExifTags import IFD, TAGS

from app.config import settings
from app.storage import format_detect, psd_thumbnail

logger = logging.getLogger(__name__)

# Second-layer bomb guard: even if a pixel buffer is touched before our explicit dimension check,
# Pillow raises DecompressionBombError past this ceiling instead of allocating unbounded memory.
PilImage.MAX_IMAGE_PIXELS = settings.max_image_pixels

# Colour management: renditions are written in sRGB and tagged as such. Browsers assume sRGB for an
# untagged JPEG, so a wide-gamut source (Adobe RGB, ProPhoto, Display-P3) whose pixels were copied
# through verbatim looked desaturated. We now transform such sources to sRGB and embed a (tiny, ~0.6 KB)
# sRGB profile so the colours are correct. Built once; None if this Pillow build lacks LittleCMS —
# then we degrade to the previous verbatim behaviour.
try:
    from PIL import ImageCms

    _SRGB_PROFILE = ImageCms.createProfile("sRGB")
    _SRGB_ICC_BYTES = ImageCms.ImageCmsProfile(_SRGB_PROFILE).tobytes()
except Exception:  # pragma: no cover - only if Pillow is built without littlecms
    ImageCms = None
    _SRGB_PROFILE = None
    _SRGB_ICC_BYTES = None


def _profile_is_srgb(icc_bytes: bytes) -> bool:
    """True if an ICC profile's description names it sRGB (so we can skip a needless round-trip)."""
    if ImageCms is None:
        return True
    try:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))
        return "srgb" in (ImageCms.getProfileDescription(src) or "").lower()
    except Exception:
        return False


def original_needs_srgb(path: str) -> bool:
    """Whether the file at `path` carries a non-sRGB ICC profile (→ its renditions must be colour-
    converted). Reads only the header. False on any error / untagged / already-sRGB source."""
    if ImageCms is None:
        return False
    try:
        with PilImage.open(path) as im:
            icc = im.info.get("icc_profile")
        return bool(icc) and not _profile_is_srgb(icc)
    except Exception:
        return False


def _to_srgb(img: PilImage.Image, icc_bytes: bytes | None) -> PilImage.Image:
    """Convert an image tagged with a non-sRGB ICC profile into sRGB so its colours are correct when
    the (sRGB-tagged) rendition is displayed. Untagged or already-sRGB images pass through unchanged;
    any CMS failure falls back to the original pixels. Handles RGB/RGBA/CMYK sources."""
    if not icc_bytes or ImageCms is None:
        return img
    if _profile_is_srgb(icc_bytes):
        return img
    if img.mode not in ("RGB", "RGBA", "CMYK"):
        return img
    try:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))
        out_mode = "RGBA" if img.mode == "RGBA" else "RGB"
        return ImageCms.profileToProfile(img, src, _SRGB_PROFILE, outputMode=out_mode)
    except Exception:
        logger.warning("ICC→sRGB conversion failed; using the untagged pixels")
        return img

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
        exif = img.getexif()
        if not exif:
            return None
        # getexif() exposes only the base IFD0 tags at the top level; the photographic fields we
        # whitelist (FNumber, ISOSpeedRatings, ExposureTime, LensModel, FocalLength,
        # DateTimeOriginal) live in the Exif sub-IFD. Merge both so the lookup below sees the same
        # flat tag space the removed _getexif() did (Pillow 12 dropped _getexif).
        raw = dict(exif)
        try:
            raw.update(exif.get_ifd(IFD.Exif))
        except Exception:
            pass
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


def _flatten_to_rgb(img: PilImage.Image) -> PilImage.Image:
    """Return an RGB copy, compositing any alpha onto white (JPEG has no alpha channel)."""
    copy = img.copy()
    if copy.mode in ("RGBA", "P", "LA"):
        bg = PilImage.new("RGB", copy.size, (255, 255, 255))
        if copy.mode == "P":
            copy = copy.convert("RGBA")
        bg.paste(copy, mask=copy.split()[-1] if copy.mode in ("RGBA", "LA") else None)
        copy = bg
    elif copy.mode != "RGB":
        copy = copy.convert("RGB")
    return copy


def _encode_jpeg(img: PilImage.Image, max_px: int, quality: int) -> bytes:
    """Shrink (never upscale) to a long edge of max_px and encode a progressive JPEG.

    The pixels are expected to be sRGB already (callers run `_to_srgb` first); we embed a small sRGB
    profile so the rendition is explicitly tagged and displays correctly everywhere."""
    if max(img.size) > max_px:
        img.thumbnail((max_px, max_px), PilImage.LANCZOS)
    buf = io.BytesIO()
    # progressive=True so the browser paints the whole frame coarse→sharp instead of scanning
    # top-to-bottom (baseline), which looked like the photo "loading from the top" in the lightbox.
    save_kwargs = {"quality": quality, "optimize": True, "progressive": True}
    if _SRGB_ICC_BYTES:
        save_kwargs["icc_profile"] = _SRGB_ICC_BYTES
    img.save(buf, "JPEG", **save_kwargs)
    return buf.getvalue()


def resize_bytes(data: bytes, max_px: int, quality: int) -> bytes:
    """Re-encode raw image bytes to a bounded, EXIF-stripped, sRGB progressive JPEG.

    Used to bound header/cover uploads on store and to derive the link-preview og:image, so neither
    serves a multi-MB original. EXIF is dropped (Pillow doesn't carry it without `exif=`). The
    module-level MAX_IMAGE_PIXELS ceiling guards against a decompression bomb on open."""
    with PilImage.open(io.BytesIO(data)) as img:
        # Colour-convert before flattening: a CMYK source must go through ICC, not a naive convert.
        rgb = _flatten_to_rgb(_to_srgb(img, img.info.get("icc_profile")))
        return _encode_jpeg(rgb, max_px, quality)


def _save_resized(
    img: PilImage.Image,
    max_px: int,
    dest_path: str,
    quality: int,
) -> None:
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with open(dest_path, "wb") as f:
        f.write(_encode_jpeg(_flatten_to_rgb(img), max_px, quality))


# Shared pool for rendition generation. Replaces FastAPI BackgroundTasks (which run serially in the
# request's thread after the response) so a batch upload renders several images at once. Each task
# opens its own DB session, so the pool is safe; busy_timeout (see database.py) absorbs the brief
# write contention when several finish together.
_executor = ThreadPoolExecutor(max_workers=settings.image_workers, thread_name_prefix="img-proc")


def submit_image_processing(image_id: str, gallery_id: str, stored_filename: str) -> None:
    """Enqueue thumb/small/medium generation on the worker pool (returns immediately)."""
    _executor.submit(process_image, image_id, gallery_id, stored_filename)


def process_image(image_id: str, gallery_id: str, stored_filename: str) -> None:
    """Worker task: generate thumb + small + medium renditions, then update the DB record.

    ``gallery_id`` is the enqueue-time gallery, but the photo may be moved to another gallery
    between upload and this task running (or while it runs). On-disk paths embed the gallery id, so
    we resolve it from the *live* DB record instead of trusting the argument — otherwise a move
    would leave the renditions in the old gallery dir while the row points at the new one (404
    previews). The argument is kept only as a fallback if the row vanished (deleted mid-flight).
    """
    from app.database import SessionLocal
    from app.repositories import image_repo, settings_repo

    db = SessionLocal()
    try:
        # Videos have no Pillow pipeline; nothing to render. (Upload normally skips
        # enqueuing this, but guard anyway so a stray call can't crash on a video.)
        image = image_repo.get_by_id(db, image_id)
        if image is not None and image.is_video:
            return
        if image is not None:
            gallery_id = image.gallery_id
        original_path = os.path.join(settings.upload_dir, gallery_id, "original", stored_filename)

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
        # Capture the source ICC profile before any transform so we can colour-manage to sRGB below.
        icc_profile = img.info.get("icc_profile")
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
        # plain transposed copy that no longer carries the EXIF / IPTC blocks, so extracting after
        # the rotate silently dropped all EXIF and IPTC. getexif() exists on every image and is
        # empty for formats without EXIF, so _extract_exif gates the empty case itself.
        exif_dict = _extract_exif(img)
        # ensure_ascii=False stores literal UTF-8 so non-ASCII IPTC values (umlauts in keywords,
        # places, names) survive as real characters — the "All Photos" filter substring-matches the
        # extracted JSON, and SQLite's json_extract of an *array* otherwise keeps \uXXXX escapes.
        exif_json = json.dumps(exif_dict, ensure_ascii=False) if exif_dict else None
        iptc_dict = _extract_iptc(img)
        iptc_json = json.dumps(iptc_dict, ensure_ascii=False) if iptc_dict else None
        img = _auto_rotate(img)
        # Colour-manage a wide-gamut source (Adobe RGB, ProPhoto, Display-P3) to sRGB once, so every
        # rendition below is written in sRGB (and tagged as such in _encode_jpeg). Untagged / already-
        # sRGB sources pass through unchanged.
        img = _to_srgb(img, icc_profile)
        width, height = img.size

        # Re-read the gallery id just before writing: decode/resize above can take seconds on a
        # large RAW, and a move committed in that window would otherwise steer the renditions into
        # the old gallery dir. (move_image relocates whatever renditions already exist; anything not
        # yet written lands here in the current gallery.)
        if image is not None:
            db.refresh(image)
            gallery_id = image.gallery_id

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
