# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import logging
import os
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.repositories import image_repo, zip_job_repo
from app.database import SessionLocal

logger = logging.getLogger(__name__)

# Originals are already-compressed formats (JPEG, camera RAW, MP4/MOV), so DEFLATE burns CPU for
# ~0% size gain — the dominant cost when zipping a large gallery, and brutal on a low-end server.
# STORED just copies bytes, making the build disk-I/O bound instead of CPU bound (much faster), and
# its predictable per-entry overhead is what later lets a streaming download set a real
# Content-Length. See docs/architecture/streaming-zip-downloads.md.
_ZIP_COMPRESSION = zipfile.ZIP_STORED


def safe_folder(name: str) -> str:
    """Filesystem-safe folder name for a gallery inside a ZIP."""
    cleaned = re.sub(r"[^\w\- ]+", "", name).strip()
    return cleaned or "gallery"


def build_zip_for_images(job_id: str, gallery_id: str, image_ids: list[str]) -> None:
    """Build a flat ZIP of a specific selection of images from one gallery (filtered download)."""
    db: Session = SessionLocal()
    try:
        job = zip_job_repo.get(db, job_id)
        if not job:
            return

        id_set = set(image_ids)
        images = [img for img in image_repo.get_by_gallery(db, gallery_id) if img.id in id_set]

        if not images:
            zip_job_repo.update_status(db, job, "error", error_message="No images to download")
            return

        os.makedirs(os.path.join(settings.exports_dir, gallery_id), exist_ok=True)
        zip_path = os.path.join(settings.exports_dir, gallery_id, f"{job_id}.zip")

        name_counts: dict[str, int] = defaultdict(int)
        total = 0
        with zipfile.ZipFile(zip_path, "w", _ZIP_COMPRESSION) as zf:
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
                zf.write(src, arcname=base)
                total += 1

        if total == 0:
            zip_job_repo.update_status(db, job, "error", error_message="No images to download")
            return

        zip_job_repo.update_status(db, job, "ready", file_path=zip_path, image_count=total)
        logger.info("Filtered ZIP built: %s (%d images)", zip_path, total)

    except Exception as exc:
        logger.error("Filtered ZIP build failed for job %s: %s", job_id, exc)
        try:
            job = zip_job_repo.get(db, job_id)
            if job:
                zip_job_repo.update_status(db, job, "error", error_message=str(exc))
        except Exception:
            pass
    finally:
        db.close()


def build_zip_multi(job_id: str, entries: list[tuple[str, str]]) -> None:
    """Build a ZIP spanning several galleries. `entries` is a list of (gallery_id, folder)
    pairs; an empty folder puts that gallery's images at the archive root."""
    db: Session = SessionLocal()
    try:
        job = zip_job_repo.get(db, job_id)
        if not job:
            return

        os.makedirs(os.path.join(settings.exports_dir, job.gallery_id), exist_ok=True)
        zip_path = os.path.join(settings.exports_dir, job.gallery_id, f"{job_id}.zip")

        total = 0
        with zipfile.ZipFile(zip_path, "w", _ZIP_COMPRESSION) as zf:
            for gallery_id, folder in entries:
                images = image_repo.get_by_gallery(db, gallery_id)
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
                    arcname = f"{folder}/{base}" if folder else base
                    zf.write(src, arcname=arcname)
                    total += 1

        if total == 0:
            zip_job_repo.update_status(db, job, "error", error_message="No images to download")
            return

        zip_job_repo.update_status(db, job, "ready", file_path=zip_path, image_count=total)
        logger.info("Multi-gallery ZIP built: %s (%d images)", zip_path, total)

    except Exception as exc:
        logger.error("Multi-gallery ZIP build failed for job %s: %s", job_id, exc)
        try:
            job = zip_job_repo.get(db, job_id)
            if job:
                zip_job_repo.update_status(db, job, "error", error_message=str(exc))
        except Exception:
            pass
    finally:
        db.close()


def build_zip(job_id: str, gallery_id: str, filter_type: str) -> None:
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
            zip_job_repo.update_status(db, job, "error", error_message="No images match filter")
            return

        os.makedirs(os.path.join(settings.exports_dir, gallery_id), exist_ok=True)
        zip_path = os.path.join(settings.exports_dir, gallery_id, f"{job_id}.zip")

        name_counts: dict[str, int] = defaultdict(int)
        with zipfile.ZipFile(zip_path, "w", _ZIP_COMPRESSION) as zf:
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
                zf.write(src, arcname=base)

        zip_job_repo.update_status(
            db, job, "ready",
            file_path=zip_path,
            image_count=len(images),
        )
        logger.info("ZIP built: %s (%d images)", zip_path, len(images))

    except Exception as exc:
        logger.error("ZIP build failed for job %s: %s", job_id, exc)
        try:
            job = zip_job_repo.get(db, job_id)
            if job:
                zip_job_repo.update_status(db, job, "error", error_message=str(exc))
        except Exception:
            pass
    finally:
        db.close()
