# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import logging
import os
import re
import zipfile
from collections import defaultdict

from sqlalchemy.orm import Session
from zipstream import ZipStream

from app.config import settings
from app.repositories import image_repo, zip_job_repo
from app.database import SessionLocal

logger = logging.getLogger(__name__)

# Originals are already-compressed formats (JPEG, camera RAW, MP4/MOV), so DEFLATE burns CPU for
# ~0% size gain — the dominant cost when zipping a large gallery, and brutal on a low-end server.
# STORED just copies bytes, making the build disk-I/O bound instead of CPU bound (much faster), and
# its predictable per-entry overhead is what lets a streaming download set a real Content-Length.
# See docs/architecture/streaming-zip-downloads.md.
_ZIP_COMPRESSION = zipfile.ZIP_STORED


def safe_folder(name: str) -> str:
    """Filesystem-safe folder name for a gallery inside a ZIP."""
    cleaned = re.sub(r"[^\w\- ]+", "", name).strip()
    return cleaned or "gallery"


def collect_members(
    db: Session,
    entries: list[tuple[str, str]],
    *,
    only_approved: bool,
    image_ids: set[str] | None = None,
) -> list[tuple[str, str]]:
    """Resolve `(gallery_id, folder)` entries to `(src_path, arcname)` pairs.

    Skips files missing on disk and de-duplicates names within each folder (``name-1.ext``). When
    `image_ids` is given, only those images are kept (a filtered selection within a single gallery).
    `only_approved` must be True on public paths so pending (unmoderated) client uploads never leak
    into a download. Shared by the on-disk builders and the streaming download."""
    members: list[tuple[str, str]] = []
    for gallery_id, folder in entries:
        images = image_repo.get_by_gallery(db, gallery_id, only_approved=only_approved)
        if image_ids is not None:
            images = [img for img in images if img.id in image_ids]
        name_counts: dict[str, int] = defaultdict(int)
        for img in images:
            src = os.path.join(settings.upload_dir, gallery_id, "original", img.stored_filename)
            if not os.path.exists(src):
                continue
            base = os.path.basename(img.original_filename)
            count = name_counts[base]
            name_counts[base] += 1
            if count:
                stem, ext = os.path.splitext(base)
                base = f"{stem}-{count}{ext}"
            members.append((src, f"{folder}/{base}" if folder else base))
    return members


def open_zip_stream(members: list[tuple[str, str]]) -> ZipStream:
    """A sized (STORED) ``ZipStream`` over `(src, arcname)` pairs. ``len(...)`` on the result is the
    exact archive byte size — set it as the response Content-Length for a real progress bar."""
    zs = ZipStream(sized=True)
    for src, arcname in members:
        zs.add_path(src, arcname)
    return zs


def _write_zip(zip_path: str, members: list[tuple[str, str]]) -> int:
    """Write `members` to an on-disk ZIP. Returns the number of files written."""
    os.makedirs(os.path.dirname(zip_path), exist_ok=True)
    total = 0
    with zipfile.ZipFile(zip_path, "w", _ZIP_COMPRESSION) as zf:
        for src, arcname in members:
            zf.write(src, arcname=arcname)
            total += 1
    return total


def _fail(db: Session, job_id: str, message: str) -> None:
    job = zip_job_repo.get(db, job_id)
    if job:
        zip_job_repo.update_status(db, job, "error", error_message=message)


def build_zip_for_images(
    job_id: str, gallery_id: str, image_ids: list[str], only_approved: bool = False
) -> None:
    """Build a flat ZIP of a specific selection of images from one gallery (filtered download)."""
    db: Session = SessionLocal()
    try:
        job = zip_job_repo.get(db, job_id)
        if not job:
            return

        members = collect_members(
            db, [(gallery_id, "")], only_approved=only_approved, image_ids=set(image_ids)
        )
        if not members:
            _fail(db, job_id, "No images to download")
            return

        zip_path = os.path.join(settings.exports_dir, gallery_id, f"{job_id}.zip")
        total = _write_zip(zip_path, members)
        zip_job_repo.update_status(db, job, "ready", file_path=zip_path, image_count=total)
        logger.info("Filtered ZIP built: %s (%d images)", zip_path, total)

    except Exception as exc:
        logger.error("Filtered ZIP build failed for job %s: %s", job_id, exc)
        try:
            _fail(db, job_id, str(exc))
        except Exception:
            pass
    finally:
        db.close()


def build_zip_multi(
    job_id: str, entries: list[tuple[str, str]], only_approved: bool = False
) -> None:
    """Build a ZIP spanning several galleries. `entries` is a list of (gallery_id, folder)
    pairs; an empty folder puts that gallery's images at the archive root."""
    db: Session = SessionLocal()
    try:
        job = zip_job_repo.get(db, job_id)
        if not job:
            return

        members = collect_members(db, entries, only_approved=only_approved)
        if not members:
            _fail(db, job_id, "No images to download")
            return

        zip_path = os.path.join(settings.exports_dir, job.gallery_id, f"{job_id}.zip")
        total = _write_zip(zip_path, members)
        zip_job_repo.update_status(db, job, "ready", file_path=zip_path, image_count=total)
        logger.info("Multi-gallery ZIP built: %s (%d images)", zip_path, total)

    except Exception as exc:
        logger.error("Multi-gallery ZIP build failed for job %s: %s", job_id, exc)
        try:
            _fail(db, job_id, str(exc))
        except Exception:
            pass
    finally:
        db.close()


def build_zip(job_id: str, gallery_id: str, filter_type: str) -> None:
    """Admin export of one gallery, optionally filtered by colour flag."""
    db: Session = SessionLocal()
    try:
        job = zip_job_repo.get(db, job_id)
        if not job:
            return

        images = image_repo.get_by_gallery(db, gallery_id)
        if filter_type == "flagged":
            images = [img for img in images if img.color_flag != "none"]
        elif filter_type != "all":
            images = [img for img in images if img.color_flag == filter_type]

        if not images:
            _fail(db, job_id, "No images match filter")
            return

        members = collect_members(
            db, [(gallery_id, "")], only_approved=False, image_ids={img.id for img in images}
        )
        if not members:
            _fail(db, job_id, "No images to download")
            return

        zip_path = os.path.join(settings.exports_dir, gallery_id, f"{job_id}.zip")
        total = _write_zip(zip_path, members)
        zip_job_repo.update_status(db, job, "ready", file_path=zip_path, image_count=total)
        logger.info("ZIP built: %s (%d images)", zip_path, total)

    except Exception as exc:
        logger.error("ZIP build failed for job %s: %s", job_id, exc)
        try:
            _fail(db, job_id, str(exc))
        except Exception:
            pass
    finally:
        db.close()
