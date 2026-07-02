# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import CodedHTTPException
from app.models.gallery import Gallery
from app.models.image import Image
from app.realtime import publish as realtime_publish
from app.repositories import activity_repo, comment_repo, gallery_repo, image_repo, like_repo, vote_repo
from app.schemas.image import GlobalSearchResult, ImageResponse, ImageUpdate, PhotoPage, UploadResponse
from app.services import gallery_service, notification_service
from app.storage import format_detect
from app.storage.base import StorageProvider
from app.tasks.image_processing import resize_bytes, submit_image_processing

# Number of leading bytes sniffed to detect the file format (covers every magic in format_detect).
_HEADER_BYTES = 32

# Human-readable list of accepted formats, for the "unsupported type" error.
_ACCEPTED_LABEL = "JPEG, PNG, WebP, TIFF, PSD, camera RAW, MP4, MOV, WebM"

# Max files a public visitor may send in one client-upload request.
CLIENT_UPLOAD_MAX_FILES = 50


def _image_to_response(
    image: Image,
    storage: StorageProvider,
    include_original_url: bool = False,
    comment_count: int = 0,
    annotation_count: int = 0,
    watermarked: bool = False,
    share_token: str | None = None,
    proxy_variants: bool = False,
) -> ImageResponse:
    gallery_id = image.gallery_id
    sf = image.stored_filename

    thumb_url = None
    small_url = None
    medium_url = None
    video_url = None
    if image.is_video:
        # No renditions; the original streams directly to a <video> tag. Always
        # exposed so clips play even when the download button is hidden, and even
        # in watermark-protected galleries (video can't be watermarked).
        video_url = storage.get_url(f"{gallery_id}/original/{sf}")
    elif image.processing_status == "done":
        # Route thumb/small/medium through the access-checked Python proxy whenever the variants
        # must be protected — watermarked galleries, OR galleries with downloads disabled. The
        # proxy serves by image.id and never exposes the stored_filename, so a viewer can't derive
        # the sibling `…/original/{sf}` static path and bypass the download gate. Public-only
        # (needs share_token); admin keeps the direct static URLs.
        if proxy_variants and share_token:
            base = f"/api/public/g/{share_token}/images/{image.id}"
            thumb_url = f"{base}/thumb"
            small_url = f"{base}/small"
            medium_url = f"{base}/medium"
        else:
            thumb_url = storage.get_url(f"{gallery_id}/thumb/{sf}")
            small_url = storage.get_url(f"{gallery_id}/small/{sf}")
            medium_url = storage.get_url(f"{gallery_id}/medium/{sf}")

    original_url = None
    if include_original_url and (image.is_video or not watermarked):
        original_url = storage.get_url(f"{gallery_id}/original/{sf}")

    exif = None
    if image.exif_data:
        try:
            exif = json.loads(image.exif_data)
        except Exception:
            pass

    iptc = None
    if image.iptc_data:
        try:
            iptc = json.loads(image.iptc_data)
        except Exception:
            pass

    return ImageResponse.model_validate({
        **image.__dict__,
        "exif_data": exif,
        "iptc_data": iptc,
        "thumb_url": thumb_url,
        "small_url": small_url,
        "medium_url": medium_url,
        "original_url": original_url,
        "video_url": video_url,
        "comment_count": comment_count,
        "annotation_count": annotation_count,
    })


def list_images(
    db: Session,
    gallery_id: str,
    storage: StorageProvider,
    include_original_url: bool = False,
    watermarked: bool = False,
    share_token: str | None = None,
    only_approved: bool = False,
    proxy_variants: bool = False,
) -> list[ImageResponse]:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    images = image_repo.get_by_gallery(db, gallery_id, only_approved=only_approved)
    image_ids = [img.id for img in images]
    counts = comment_repo.counts_for_images(db, image_ids)
    anno_counts = comment_repo.anchored_counts_for_images(db, image_ids)
    return [
        _image_to_response(
            img, storage, include_original_url, counts.get(img.id, 0),
            anno_counts.get(img.id, 0), watermarked, share_token,
            proxy_variants=proxy_variants,
        )
        for img in images
    ]


def search_images(
    db: Session,
    ranked: list[tuple[str, float]],
    storage: StorageProvider,
) -> list[ImageResponse]:
    """Serialize semantic-search hits (admin view), preserving the similarity ranking. `ranked` is
    a list of (image_id, score) pairs; missing/soft-deleted ids are dropped."""
    if not ranked:
        return []
    image_ids = [iid for iid, _ in ranked]
    images = image_repo.get_many(db, image_ids)
    counts = comment_repo.counts_for_images(db, image_ids)
    anno_counts = comment_repo.anchored_counts_for_images(db, image_ids)
    out: list[ImageResponse] = []
    for iid, _score in ranked:
        img = images.get(iid)
        if img is None:
            continue
        out.append(
            _image_to_response(
                img, storage, True, counts.get(iid, 0), anno_counts.get(iid, 0)
            )
        )
    return out


def _with_gallery_context(
    db: Session, responses: list[ImageResponse]
) -> list[GlobalSearchResult]:
    """Tag each serialized image with its gallery's name + share token (for the overview's badge +
    deep-link). One batched gallery fetch, order preserved."""
    galleries = gallery_repo.get_by_ids(db, [r.gallery_id for r in responses])
    out: list[GlobalSearchResult] = []
    for r in responses:
        g = galleries.get(r.gallery_id)
        out.append(
            GlobalSearchResult(
                **r.model_dump(),
                gallery_name=g.name if g else "",
                gallery_share_token=g.share_token if g else "",
            )
        )
    return out


def global_search_images(
    db: Session,
    ranked: list[tuple[str, float]],
    storage: StorageProvider,
) -> list[GlobalSearchResult]:
    """Instance-wide semantic search hits, each tagged with its gallery context."""
    return _with_gallery_context(db, search_images(db, ranked, storage))


def list_all_photos(
    db: Session,
    storage: StorageProvider,
    sort: str,
    direction: str,
    limit: int,
    offset: int,
    name_filter: str | None = None,
) -> PhotoPage:
    """A page of the cross-gallery "All Photos" browser — every photo, sorted by date/name, each
    tagged with its gallery. `name_filter` narrows by filename (the fallback search when semantic
    search is off); semantic search uses a separate path."""
    items, total = image_repo.list_all(db, sort, direction, limit, offset, name_filter=name_filter)
    ids = [img.id for img in items]
    counts = comment_repo.counts_for_images(db, ids)
    anno_counts = comment_repo.anchored_counts_for_images(db, ids)
    responses = [
        _image_to_response(img, storage, True, counts.get(img.id, 0), anno_counts.get(img.id, 0))
        for img in items
    ]
    return PhotoPage(
        items=_with_gallery_context(db, responses), total=total, offset=offset, limit=limit
    )


def upload_images(
    db: Session,
    gallery_id: str,
    files: list[UploadFile],
    storage: StorageProvider,
    uploaded_by: str | None = None,
    moderation_status: str = "approved",
    max_image_bytes: int | None = None,
    max_total_bytes: int | None = None,
    allow_video: bool = True,
) -> list[UploadResponse]:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    results = []
    existing_count = image_repo.count_by_gallery(db, gallery_id)
    image_cap = max_image_bytes or settings.max_upload_bytes
    total_bytes = 0

    for file in files:
        # Detect the real format from the leading bytes — the browser content_type is unreliable
        # (often empty/octet-stream) for TIFF/PSD/RAW. Peek the header, then rewind for the stream.
        header = file.file.read(_HEADER_BYTES)
        file.file.seek(0)
        fmt = format_detect.detect_format(header, file.filename or "")
        if fmt is None:
            raise CodedHTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                code="upload_unsupported_type",
                detail=f"Unsupported file type. Allowed: {_ACCEPTED_LABEL}",
            )
        is_video = fmt.kind == "video"
        if is_video and not allow_video:
            raise CodedHTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                code="client_upload_video",
                detail="Video upload is not available for client uploads — images only",
            )

        mime = fmt.mime
        # Videos are stored as-is (no transcoding) and carry a larger size cap.
        size_cap = settings.max_video_bytes if is_video else image_cap
        stored_filename = f"{uuid.uuid4()}{fmt.ext}"

        # Folder uploads send a relative path as the filename (e.g. "shoot/IMG_1.jpg").
        # Keep only the base name so exports, ZIPs and copy-filenames never leak the path.
        # Handle both POSIX and Windows separators regardless of host OS.
        original_filename = (file.filename or stored_filename).replace("\\", "/").rsplit("/", 1)[-1]
        relative_path = f"{gallery_id}/original/{stored_filename}"

        _CHUNK = 1024 * 1024
        file_size = 0
        tmp_fd, tmp_path = tempfile.mkstemp()
        try:
            with os.fdopen(tmp_fd, "wb") as out:
                while chunk := file.file.read(_CHUNK):
                    file_size += len(chunk)
                    # Per-file cap, and (for client uploads) a per-request total so a single
                    # request can't write unbounded attacker-controlled bytes to disk. Both abort
                    # mid-stream before the chunk is written.
                    if file_size > size_cap or (max_total_bytes and total_bytes + file_size > max_total_bytes):
                        raise CodedHTTPException(
                            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                            code="upload_too_large",
                            detail="File exceeds maximum upload size",
                        )
                    out.write(chunk)
            total_bytes += file_size
            # No separate content/declared-type check: the format was derived from the bytes
            # themselves (detect_format), so a spoofed extension can't smuggle a different type.
            with open(tmp_path, "rb") as src:
                storage.save(relative_path, src)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        # Videos need no Pillow pipeline — the browser renders its own poster, so the
        # row is "done" on arrival. Images stay "pending" until thumb/medium exist.
        image = image_repo.create(
            db,
            id=str(uuid.uuid4()),
            gallery_id=gallery_id,
            original_filename=original_filename,
            stored_filename=stored_filename,
            file_size=file_size,
            mime_type=mime,
            sort_order=existing_count + len(results),
            processing_status="done" if is_video else "pending",
            # Videos are never embedded; mark them skipped up front so the index status is accurate
            # without waiting for a backfill pass. Images are indexed after their renditions exist.
            embedding_status="skipped" if is_video else "pending",
            is_video=is_video,
            uploaded_by=uploaded_by,
            moderation_status=moderation_status,
            created_at=datetime.now(timezone.utc),
        )

        if not is_video:
            submit_image_processing(image.id, gallery_id, stored_filename)

        results.append(UploadResponse(
            id=image.id,
            original_filename=image.original_filename,
            file_size=image.file_size,
            mime_type=image.mime_type,
            processing_status=image.processing_status,
            is_video=is_video,
        ))

    return results


def client_upload_images(
    db: Session,
    gallery: Gallery,
    files: list[UploadFile],
    uploader: str | None,
    storage: StorageProvider,
    ip: str | None = None,
) -> list[UploadResponse]:
    """Public client upload. Gated by the gallery's client_upload_enabled toggle; the caller is
    responsible for the password access check. Files become visible like any other photo."""
    if not gallery.client_upload_enabled:
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="client_upload_disabled",
            detail="Client upload is not enabled for this gallery",
        )
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files provided")
    if len(files) > CLIENT_UPLOAD_MAX_FILES:
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="client_upload_too_many",
            detail=f"Too many files in one upload (max {CLIENT_UPLOAD_MAX_FILES})",
        )
    name = (uploader or "").strip()[:100] or "Guest"
    # Moderated galleries hold client uploads in the approval queue until the photographer reviews;
    # otherwise they're public the moment processing finishes (legacy behaviour).
    pending = bool(gallery.client_upload_moderation)
    results = upload_images(
        db, gallery.id, files, storage,
        uploaded_by=name,
        moderation_status="pending" if pending else "approved",
        max_image_bytes=settings.client_upload_max_file_bytes,
        max_total_bytes=settings.client_upload_max_total_bytes,
        allow_video=False,
    )
    if results:
        # Record the client contribution in the activity log (admin uploads go a different path
        # and are never logged here). IP is attached only when IP logging is enabled.
        activity_repo.log(
            db, gallery.id, "uploaded", name, ip=ip, meta={"count": len(results)}
        )
    if pending and results:
        notification_service.enqueue(
            db, gallery.id, "upload", name, meta={"count": len(results)}
        )
    return results


def update_image(db: Session, image_id: str, data: ImageUpdate) -> Image:
    image = image_repo.get_by_id(db, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    updates: dict = {}
    if data.sort_order is not None:
        updates["sort_order"] = data.sort_order
    if data.color_flag is not None:
        updates["color_flag"] = data.color_flag
    if data.rating is not None:
        updates["rating"] = data.rating
    if data.original_filename is not None:
        updates["original_filename"] = data.original_filename.strip() or image.original_filename

    if updates:
        image = image_repo.update_fields(db, image, **updates)
        realtime_publish(image.gallery_id, "image", image_id=image_id)
    return image


def move_image(db: Session, image_id: str, target_gallery_id: str, storage: StorageProvider) -> Image:
    image = image_repo.get_by_id(db, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    target = gallery_repo.get_by_id(db, target_gallery_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target gallery not found")
    if image.gallery_id == target_gallery_id:
        return image

    src_gallery = image.gallery_id
    sf = image.stored_filename
    for subdir in ("original", "thumb", "medium"):
        src = f"{src_gallery}/{subdir}/{sf}"
        dst = f"{target_gallery_id}/{subdir}/{sf}"
        if storage.exists(src):
            storage.move(src, dst)

    new_sort = len(image_repo.get_by_gallery(db, target_gallery_id))
    moved = image_repo.update_fields(db, image, gallery_id=target_gallery_id, sort_order=new_sort)
    # Per-reviewer likes/votes are filtered by gallery_id, so they must follow the image to its new
    # gallery — otherwise the heart reads empty there while a stale like silently lingers.
    like_repo.reassign_gallery(db, image_id, target_gallery_id)
    vote_repo.reassign_gallery(db, image_id, target_gallery_id)
    realtime_publish(src_gallery, "image", image_id=image_id)
    realtime_publish(target_gallery_id, "image", image_id=image_id)
    return moved


def copy_image_to_gallery(
    db: Session, image: Image, target_gallery_id: str, storage: StorageProvider, sort_order: int
) -> Image:
    """Duplicate an image (a new row + new files) into another gallery. Intrinsic metadata carries
    over; feedback (flag/likes/uploader/moderation) is reset so the copy starts clean — comments,
    annotations and votes are keyed by image id, so the new row simply has none."""
    src_gallery = image.gallery_id
    ext = os.path.splitext(image.stored_filename)[1]
    new_filename = f"{uuid.uuid4()}{ext}"
    for subdir in ("original", "thumb", "medium"):
        src = f"{src_gallery}/{subdir}/{image.stored_filename}"
        if storage.exists(src):
            storage.copy(src, f"{target_gallery_id}/{subdir}/{new_filename}")

    return image_repo.create(
        db,
        gallery_id=target_gallery_id,
        original_filename=image.original_filename,
        stored_filename=new_filename,
        width=image.width,
        height=image.height,
        file_size=image.file_size,
        mime_type=image.mime_type,
        exif_data=image.exif_data,
        iptc_data=image.iptc_data,
        tags=image.tags,
        is_video=image.is_video,
        video_poster_filename=image.video_poster_filename,
        processing_status="done",
        sort_order=sort_order,
        # feedback intentionally reset (defaults): color_flag="none", likes=0,
        # uploaded_by=None, moderation_status="approved".
    )


def transfer_images(
    db: Session,
    *,
    image_ids: list[str],
    source_gallery_id: str,
    target_gallery_id: str,
    operation: str,
    storage: StorageProvider,
) -> list[Image]:
    """Copy or move a set of images from one gallery to another, appended in the given order. The
    single bulk primitive behind both 'create gallery from images' and 'copy/move to an existing
    gallery'."""
    if source_gallery_id == target_gallery_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and target are the same gallery")
    if not gallery_repo.get_by_id(db, target_gallery_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target gallery not found")

    live = {img.id: img for img in image_repo.get_by_gallery(db, source_gallery_id)}
    # Keep only ids belonging to the source (preserve order, drop dupes), like collection create.
    seen: set[str] = set()
    ordered = [live[i] for i in image_ids if i in live and not (i in seen or seen.add(i))]
    if not ordered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid images to transfer")

    base = len(image_repo.get_by_gallery(db, target_gallery_id))
    results: list[Image] = []
    for offset, image in enumerate(ordered):
        if operation == "copy":
            results.append(copy_image_to_gallery(db, image, target_gallery_id, storage, base + offset))
        else:
            results.append(move_image(db, image.id, target_gallery_id, storage))
    if operation == "copy":
        realtime_publish(target_gallery_id, "image")
    return results


def use_image_as_header(
    db: Session, gallery_id: str, image_id: str, storage: StorageProvider, header_dir: str
) -> None:
    import uuid as _uuid
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if image.is_video:
        # A video has no Pillow-readable rendition; resize_bytes below would fail on it. Reject
        # cleanly instead of writing a broken header.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot use a video as the header image")
    if image.processing_status != "done":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image not yet processed")

    src_path = f"{gallery_id}/medium/{image.stored_filename}"
    if not storage.exists(src_path):
        # Renditions not ready (or none for this format) → fall back to the original. Bound it below
        # so a missing `medium` can't make the header a multi-MB original (which broke WhatsApp link
        # previews). See docs/architecture/header-cover-uploads-and-og-image-sizing.md.
        src_path = f"{gallery_id}/original/{image.stored_filename}"

    # Header is stored as a bounded JPEG regardless of source.
    filename = f"{_uuid.uuid4()}.jpg"
    dst_dir = os.path.join(header_dir, gallery_id)
    os.makedirs(dst_dir, exist_ok=True)

    # Remove old header file if present
    if gallery.header_image_filename:
        old = os.path.join(dst_dir, gallery.header_image_filename)
        try:
            os.remove(old)
        except FileNotFoundError:
            pass

    data = resize_bytes(
        storage.read_bytes(src_path), settings.header_max_px, settings.header_quality
    )
    with open(os.path.join(dst_dir, filename), "wb") as f:
        f.write(data)

    gallery_repo.update(db, gallery, header_image_filename=filename)


def delete_image(db: Session, image_id: str) -> None:
    image = image_repo.get_by_id(db, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    gallery_id = image.gallery_id
    image_repo.soft_delete(db, image)
    realtime_publish(gallery_id, "image", image_id=image_id)


def approve_image(db: Session, image_id: str) -> Image:
    """Approve a pending client upload so it becomes public. No-op if already approved."""
    image = image_repo.get_by_id(db, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if image.moderation_status != "approved":
        image = image_repo.update_fields(db, image, moderation_status="approved")
        try:
            activity_repo.log(db, image.gallery_id, "approved", "admin", image_id=image_id)
        except Exception:
            pass
        # Now visible to the public room — let viewers refetch and pick it up.
        realtime_publish(image.gallery_id, "image", image_id=image_id)
    return image


def approve_images(db: Session, gallery_id: str, image_ids: list[str]) -> int:
    """Bulk-approve pending uploads in a gallery. Returns the number actually flipped."""
    n = 0
    for image_id in image_ids:
        image = image_repo.get_by_id(db, image_id)
        if image and image.gallery_id == gallery_id and image.moderation_status != "approved":
            image_repo.update_fields(db, image, moderation_status="approved")
            n += 1
    if n:
        try:
            activity_repo.log(db, gallery_id, "approved", "admin", meta={"count": n})
        except Exception:
            pass
        realtime_publish(gallery_id, "image")
    return n


def reorder_images(db: Session, gallery_id: str, image_ids: list[str]) -> None:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    image_repo.set_sort_orders(db, gallery_id, image_ids)
    realtime_publish(gallery_id, "image")


def public_set_flag(
    db: Session, gallery: Gallery, image_id: str, flag: str, reviewer_name: str = "client"
) -> Image:
    if not gallery_service.review_active(gallery):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gallery is not in collaboration mode")
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery.id or image.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    updated = image_repo.update_fields(db, image, color_flag=flag)
    try:
        activity_repo.log(db, gallery.id, "flagged", reviewer_name, image_id=image_id, meta={"flag": flag})
    except Exception:
        pass
    notification_service.enqueue(db, gallery.id, "flag", reviewer_name, meta={"image_id": image_id, "flag": flag})
    realtime_publish(gallery.id, "flag", image_id=image_id)
    return updated


def public_set_rating(
    db: Session, gallery: Gallery, image_id: str, rating: int, reviewer_name: str = "client"
) -> Image:
    """Set the shared 1–5 star rating (0 clears) — the stars-mode parallel to public_set_flag.
    Rides the same activity/notification/realtime channel so the grid invalidates identically."""
    if not gallery_service.review_active(gallery):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gallery is not in collaboration mode")
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery.id or image.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    updated = image_repo.update_fields(db, image, rating=rating)
    try:
        activity_repo.log(db, gallery.id, "rated", reviewer_name, image_id=image_id, meta={"rating": rating})
    except Exception:
        pass
    notification_service.enqueue(db, gallery.id, "flag", reviewer_name, meta={"image_id": image_id, "rating": rating})
    realtime_publish(gallery.id, "flag", image_id=image_id)
    return updated


def public_toggle_like(db: Session, gallery: Gallery, image_id: str, reviewer_name: str) -> Image:
    """Toggle this reviewer's like (one like per person). Notifies / logs only when liking,
    not on un-like, to avoid noise."""
    if not gallery_service.review_active(gallery):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gallery is not in collaboration mode")
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery.id or image.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    liked = like_repo.toggle(db, image_id, gallery.id, reviewer_name)
    if liked:
        try:
            activity_repo.log(db, gallery.id, "liked", reviewer_name, image_id=image_id)
        except Exception:
            pass
        notification_service.enqueue(db, gallery.id, "flag", reviewer_name, meta={"image_id": image_id})
    realtime_publish(gallery.id, "flag", image_id=image_id)
    return db.get(Image, image_id)
