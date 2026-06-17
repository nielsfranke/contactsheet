# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import json
import os
import re

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_optional_admin, get_optional_gallery_token
from app.auth.jwt import create_gallery_token
from app.auth.password import verify_password
from app.config import settings as app_settings
from app.database import get_db
from app.errors import CodedHTTPException
from app.dependencies import get_storage
from app.rate_limit import limiter
from app.realtime import publish as realtime_publish
from app.repositories import activity_repo, comment_repo, gallery_repo, image_repo, like_repo, vote_repo, zip_job_repo
from app.schemas.auth import GalleryAuthRequest, GalleryAuthResponse
from app.schemas.collection import CollectionCreate, CollectionResponse, CollectionUpdate
from app.schemas.comment import CommentCreate, CommentResponse
from app.schemas.gallery import GalleryPublicResponse
from app.schemas.image import ImageResponse, PublicFlagRequest, PublicLikeRequest, UploadResponse
from app.schemas.vote import VoteCreate, VoteResponse
from app.schemas.zip_job import PublicZipCreate, ZipJobResponse
from app.services import activity_service, collection_service, comment_service, gallery_service, image_service, notification_service, watermark_service
from app.storage.base import StorageProvider
from app.tasks.zip_task import build_zip_for_images, build_zip_multi, safe_folder

router = APIRouter(prefix="/api/public", tags=["public"])


def _public_zip_response(job, share_token: str) -> ZipJobResponse:
    download_url = None
    if job.status == "ready":
        download_url = f"/api/public/g/{share_token}/zip/{job.id}/download"
    return ZipJobResponse(
        id=job.id,
        gallery_id=job.gallery_id,
        status=job.status,
        filter_type=job.filter_type,
        image_count=job.image_count,
        error_message=job.error_message,
        created_at=job.created_at,
        ready_at=job.ready_at,
        download_url=download_url,
    )


def _require_gallery_access(gallery, gallery_id_from_token: str | None):
    """Raise 401 if gallery is password-protected and token doesn't match."""
    if gallery.password_hash and gallery_id_from_token != gallery.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Gallery access token required")


@router.get("/g/{share_token}")
def get_public_gallery(
    request: Request,
    share_token: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
    is_admin: bool = Depends(get_optional_admin),
):
    gallery, public_response = gallery_service.get_public_gallery(db, share_token, storage)

    if gallery.password_hash:
        if gallery_id_from_token != gallery.id:
            return {"requires_password": True}

    # Notify + log the share-link open (skip the photographer's own preview). The activity row is
    # deduped per IP and only written when IP logging is enabled.
    if not is_admin:
        notification_service.enqueue(db, gallery.id, "view")
        activity_service.log_view(db, gallery.id, request)

    return public_response


@router.post("/g/{share_token}/auth", response_model=GalleryAuthResponse)
@limiter.limit("20/minute")
def auth_gallery(
    request: Request,
    share_token: str,
    body: GalleryAuthRequest,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)

    if not gallery.password_hash:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gallery has no password")

    if not verify_password(body.password, gallery.password_hash):
        raise CodedHTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="gallery_password_invalid",
            detail="Wrong password",
        )

    token = create_gallery_token(gallery.id)
    return GalleryAuthResponse(access_token=token)


@router.get("/g/{share_token}/images", response_model=list[ImageResponse])
def get_public_images(
    share_token: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, public = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)

    return image_service.list_images(
        db,
        gallery.id,
        storage,
        include_original_url=gallery.downloads_enabled,
        watermarked=public.watermark_enabled,
        share_token=share_token,
        only_approved=True,
        # Hide the stored_filename (and thus the derivable original path) for protected galleries.
        proxy_variants=public.watermark_enabled or not gallery.downloads_enabled,
    )


@router.post("/g/{share_token}/images", response_model=list[UploadResponse], status_code=201)
@limiter.limit("10/minute")
def client_upload_images(
    request: Request,
    share_token: str,
    files: list[UploadFile] = File(...),
    uploader: str = Form(""),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    ip = activity_service.resolve_ip(db, request)
    return image_service.client_upload_images(db, gallery, files, uploader, storage, background_tasks, ip=ip)


def _require_collections(gallery):
    if not gallery.sets_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Collections are not enabled for this gallery")


@router.get("/g/{share_token}/collections", response_model=list[CollectionResponse])
def list_public_collections(
    share_token: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    _require_collections(gallery)
    return collection_service.list_collections(db, gallery.id, storage)


@router.post("/g/{share_token}/collections", response_model=CollectionResponse, status_code=201)
@limiter.limit("20/minute")
def create_public_collection(
    request: Request,
    share_token: str,
    body: CollectionCreate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    _require_collections(gallery)
    created_by = (body.creator or "").strip()[:100] or "Guest"
    return collection_service.create_collection(db, gallery.id, body, storage, created_by=created_by)


@router.patch("/g/{share_token}/collections/{collection_id}", response_model=CollectionResponse)
@limiter.limit("30/minute")
def update_public_collection(
    request: Request,
    share_token: str,
    collection_id: str,
    body: CollectionUpdate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    _require_collections(gallery)
    actor = (body.actor or "").strip()[:100] or "Guest"
    return collection_service.update_collection(
        db, gallery.id, collection_id, body, storage, actor=actor, is_admin=False
    )


@router.delete("/g/{share_token}/collections/{collection_id}", status_code=204)
@limiter.limit("30/minute")
def delete_public_collection(
    request: Request,
    share_token: str,
    collection_id: str,
    reviewer: str = "",
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    _require_collections(gallery)
    actor = (reviewer or "").strip()[:100] or "Guest"
    collection_service.delete_collection(db, gallery.id, collection_id, actor=actor, is_admin=False)


@router.post("/g/{share_token}/images/{image_id}/flag", response_model=ImageResponse)
@limiter.limit("120/minute")
def flag_image(
    request: Request,
    share_token: str,
    image_id: str,
    body: PublicFlagRequest,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, public = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)

    image = image_service.public_set_flag(db, gallery, image_id, body.flag)
    count = comment_repo.count_for_image(db, image_id)
    acount = comment_repo.anchored_counts_for_images(db, [image_id]).get(image_id, 0)
    return image_service._image_to_response(
        image, storage, gallery.downloads_enabled, count, acount,
        watermarked=public.watermark_enabled, share_token=share_token,
        proxy_variants=public.watermark_enabled or not gallery.downloads_enabled,
    )


@router.get("/g/{share_token}/likes", response_model=list[str])
def get_likes(
    share_token: str,
    reviewer: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    """Image ids in this gallery the reviewer has liked (so the heart shows filled for them)."""
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    return like_repo.liked_image_ids(db, gallery.id, reviewer)


@router.post("/g/{share_token}/images/{image_id}/like", response_model=ImageResponse)
@limiter.limit("120/minute")
def like_image(
    request: Request,
    share_token: str,
    image_id: str,
    body: PublicLikeRequest,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, public = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)

    image = image_service.public_toggle_like(db, gallery, image_id, body.reviewer)
    count = comment_repo.count_for_image(db, image_id)
    acount = comment_repo.anchored_counts_for_images(db, [image_id]).get(image_id, 0)
    return image_service._image_to_response(
        image, storage, gallery.downloads_enabled, count, acount,
        watermarked=public.watermark_enabled, share_token=share_token,
        proxy_variants=public.watermark_enabled or not gallery.downloads_enabled,
    )


@router.get("/g/{share_token}/images/{image_id}/comments", response_model=list[CommentResponse])
def get_comments(
    share_token: str,
    image_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)

    # Verify image belongs to this gallery
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery.id or image.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    return comment_service.list_comments(db, image_id)


@router.get("/g/{share_token}/images/{image_id}/medium")
def get_watermarked_medium(
    share_token: str,
    image_id: str,
    request: Request,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    return _watermarked_variant("medium", share_token, image_id, request, db, storage, gallery_id_from_token)


@router.get("/g/{share_token}/images/{image_id}/small")
def get_watermarked_small(
    share_token: str,
    image_id: str,
    request: Request,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    return _watermarked_variant("small", share_token, image_id, request, db, storage, gallery_id_from_token)


@router.get("/g/{share_token}/images/{image_id}/thumb")
def get_watermarked_thumb(
    share_token: str,
    image_id: str,
    request: Request,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    return _watermarked_variant("thumb", share_token, image_id, request, db, storage, gallery_id_from_token)


def _watermarked_variant(
    variant: str,
    share_token: str,
    image_id: str,
    request: Request,
    db: Session,
    storage: StorageProvider,
    gallery_id_from_token: str | None,
):
    import hashlib
    from fastapi.responses import FileResponse, Response as FastAPIResponse
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)

    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery.id or image.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    src_path = os.path.join(app_settings.upload_dir, gallery.id, variant, image.stored_filename)
    if not os.path.exists(src_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image file not found")

    ws: dict = {}
    if gallery.watermark_settings:
        try:
            ws = json.loads(gallery.watermark_settings)
        except Exception:
            pass

    if not watermark_service.is_active(ws):
        return FileResponse(src_path, media_type="image/jpeg")

    # Cache composited watermark to disk; key on image id + watermark settings hash
    wm_hash = hashlib.sha1(json.dumps(ws, sort_keys=True).encode()).hexdigest()[:12]
    cache_dir = os.path.join(app_settings.upload_dir, gallery.id, f"{variant}-wm")
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{image.id}_{wm_hash}.jpg")
    etag = f'"{image.id}-{variant}-{wm_hash}"'

    if request.headers.get("if-none-match") == etag:
        return FastAPIResponse(status_code=304)

    if not os.path.exists(cache_path):
        with open(src_path, "rb") as f:
            img_bytes = f.read()
        composited = watermark_service.apply_watermark(img_bytes, gallery.id, ws)
        with open(cache_path, "wb") as f:
            f.write(composited)

    return FileResponse(
        cache_path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=3600",
            "ETag": etag,
        },
    )


@router.get("/g/{share_token}/votes", response_model=list[VoteResponse])
def get_votes(
    share_token: str,
    reviewer: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    if not gallery.enable_team_voting:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team voting not enabled")
    return vote_repo.get_votes_for_reviewer(db, gallery.id, reviewer)


@router.put("/g/{share_token}/images/{image_id}/vote", response_model=VoteResponse)
@limiter.limit("120/minute")
def set_vote(
    request: Request,
    share_token: str,
    image_id: str,
    body: VoteCreate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    if not gallery.enable_team_voting:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team voting not enabled")

    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery.id or image.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    vote = vote_repo.upsert(db, image_id, gallery.id, body.reviewer_name, body.color_flag)
    try:
        activity_repo.log(
            db, gallery.id, "voted", body.reviewer_name,
            image_id=image_id, meta={"flag": body.color_flag}
        )
    except Exception:
        pass
    notification_service.enqueue(db, gallery.id, "flag", body.reviewer_name, meta={"image_id": image_id, "flag": body.color_flag})
    realtime_publish(gallery.id, "vote", image_id=image_id)
    return vote


@router.post("/g/{share_token}/images/{image_id}/comments", response_model=CommentResponse, status_code=201)
@limiter.limit("30/minute")
def add_comment(
    request: Request,
    share_token: str,
    image_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)

    if gallery.mode != "collaboration":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Gallery is not in collaboration mode")

    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery.id or image.moderation_status != "approved":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    # Anchored comments (annotations) ride the same endpoint but need the per-gallery toggle.
    if body.anchor is not None and not gallery.annotations_enabled:
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="annotations_disabled",
            detail="Annotations are not enabled for this gallery",
        )

    return comment_service.add_comment(db, image_id, body)


@router.delete("/g/{share_token}/images/{image_id}/comments/{comment_id}", status_code=204)
@limiter.limit("30/minute")
def public_delete_comment(
    request: Request,
    share_token: str,
    image_id: str,
    comment_id: str,
    reviewer: str = "",
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    # Public callers may only delete their own (author_name matches the reviewer name they pass).
    comment_service.delete_comment(db, gallery.id, image_id, comment_id, requester_name=reviewer)


@router.post("/g/{share_token}/zip", response_model=ZipJobResponse, status_code=202)
@limiter.limit("10/minute")
def create_public_zip(
    request: Request,
    share_token: str,
    body: PublicZipCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
    is_admin: bool = Depends(get_optional_admin),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    if not gallery.downloads_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Downloads are disabled for this gallery")

    # Record + notify the download (skip the photographer's own download).
    def _record_download(count: int) -> None:
        if is_admin:
            return
        activity_service.log_download(db, gallery.id, request, count)
        notification_service.enqueue(db, gallery.id, "download", meta={"count": count})

    # Filtered download: a specific selection of this gallery's own images (sub-galleries ignored).
    if body.image_ids:
        gallery_image_ids = {img.id for img in image_repo.get_by_gallery(db, gallery.id)}
        wanted = [iid for iid in body.image_ids if iid in gallery_image_ids]
        if not wanted:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to download in the current selection")
        zip_job_repo.purge_expired(db)
        job = zip_job_repo.create(db, gallery.id, "all")
        background_tasks.add_task(build_zip_for_images, job.id, gallery.id, wanted)
        _record_download(len(wanted))
        return _public_zip_response(job, share_token)

    children = gallery_repo.get_children(db, gallery.id)
    selected = [c for c in children if c.share_token in set(body.subgallery_share_tokens)]

    # Image counts to validate the selection actually holds files.
    ids = [gallery.id] + [c.id for c in selected]
    counts = gallery_repo.batch_image_counts(db, ids)
    root_count = counts.get(gallery.id, 0)

    # Build (gallery_id, folder) entries. With no sub-galleries selected the archive is flat;
    # otherwise each gallery's images go into a folder named after it.
    entries: list[tuple[str, str]] = []
    if not selected:
        entries.append((gallery.id, ""))
    else:
        if root_count > 0:
            entries.append((gallery.id, safe_folder(gallery.name)))
        for c in selected:
            entries.append((c.id, safe_folder(c.name)))

    total = sum(counts.get(gid, 0) for gid, _ in entries)
    if total == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to download in the current selection")

    zip_job_repo.purge_expired(db)
    job = zip_job_repo.create(db, gallery.id, "all")
    background_tasks.add_task(build_zip_multi, job.id, entries)
    _record_download(total)
    return _public_zip_response(job, share_token)


@router.get("/g/{share_token}/zip/{job_id}", response_model=ZipJobResponse)
def get_public_zip(
    share_token: str,
    job_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    job = zip_job_repo.get(db, job_id)
    if not job or job.gallery_id != gallery.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return _public_zip_response(job, share_token)


@router.get("/g/{share_token}/zip/{job_id}/download")
def download_public_zip(
    share_token: str,
    job_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    gallery_id_from_token: str | None = Depends(get_optional_gallery_token),
):
    gallery, _ = gallery_service.get_public_gallery(db, share_token, storage)
    _require_gallery_access(gallery, gallery_id_from_token)
    job = zip_job_repo.get(db, job_id)
    if not job or job.gallery_id != gallery.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if job.status != "ready" or not job.file_path or not os.path.exists(job.file_path):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ZIP not ready")

    filename = f"{safe_folder(gallery.name)}.zip"
    return FileResponse(
        job.file_path,
        media_type="application/zip",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
