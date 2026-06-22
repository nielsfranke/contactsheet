# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.config import settings as app_settings
from app.utils import assert_image_magic, read_limited
from app.database import get_db
from app.dependencies import get_storage
from app.repositories import activity_repo, gallery_repo, image_repo, vote_repo
from app.schemas.activity import ActivityPage
from app.schemas.comment import CommentCreate, CommentResponse, CommentUpdate
from app.schemas.vote import VoteSummaryResponse
from app.schemas.gallery import (
    GalleryCreate,
    GalleryDerive,
    GalleryMove,
    GalleryResponse,
    GalleryUpdate,
    ShareTokenUpdate,
)
from app.schemas.image import ImageResponse, ImageTransfer, ReorderRequest, TransferResult
from app.services import comment_service, gallery_service, image_service, semantic_search_service
from app.storage.base import StorageProvider

router = APIRouter(prefix="/api/galleries", tags=["galleries"])


@router.get("", response_model=list[GalleryResponse])
def list_galleries(
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return gallery_service.list_gallery_tree(db, storage)


@router.post("", response_model=GalleryResponse, status_code=201)
def create_gallery(
    body: GalleryCreate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return gallery_service.create_gallery(db, body, storage)


@router.get("/{gallery_id}", response_model=GalleryResponse)
def get_gallery(
    gallery_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return gallery_service.get_gallery(db, gallery_id, storage)


@router.patch("/{gallery_id}", response_model=GalleryResponse)
def update_gallery(
    gallery_id: str,
    body: GalleryUpdate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return gallery_service.update_gallery(db, gallery_id, body, storage)


@router.post("/{gallery_id}/move", response_model=GalleryResponse)
def move_gallery(
    gallery_id: str,
    body: GalleryMove,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return gallery_service.move_gallery(db, gallery_id, body.target_parent_id, storage)


@router.post("/{gallery_id}/derive", response_model=GalleryResponse, status_code=201)
def derive_gallery(
    gallery_id: str,
    body: GalleryDerive,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    """Create a new gallery from a set of this gallery's images (collection / filter / selection)."""
    return gallery_service.derive_gallery(db, gallery_id, body, storage)


@router.post("/{gallery_id}/images/transfer", response_model=TransferResult)
def transfer_images(
    gallery_id: str,
    body: ImageTransfer,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    """Copy or move a set of this gallery's images into an existing target gallery."""
    moved = image_service.transfer_images(
        db,
        image_ids=body.image_ids,
        source_gallery_id=gallery_id,
        target_gallery_id=body.target_gallery_id,
        operation=body.operation,
        storage=storage,
    )
    return TransferResult(count=len(moved), target_gallery_id=body.target_gallery_id)


@router.post("/{gallery_id}/share-token", response_model=GalleryResponse)
def set_share_token(
    gallery_id: str,
    body: ShareTokenUpdate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return gallery_service.set_share_token(db, gallery_id, body.strategy, body.value, storage)


@router.delete("/{gallery_id}", status_code=204)
def delete_gallery(
    gallery_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    gallery_service.delete_gallery(db, gallery_id)


@router.delete("/{gallery_id}/contents", status_code=204)
def empty_gallery(
    gallery_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    gallery_service.empty_gallery(db, gallery_id)


@router.get("/{gallery_id}/images", response_model=list[ImageResponse])
def list_images(
    gallery_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return image_service.list_images(db, gallery_id, storage, include_original_url=True)


@router.get("/{gallery_id}/search", response_model=list[ImageResponse])
def search_gallery(
    gallery_id: str,
    q: str = Query(..., min_length=1, max_length=200),
    threshold: float | None = Query(None, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    """Semantic search within this gallery and its sub-galleries. Results are ranked by similarity;
    `threshold` (0..1) overrides the configured accuracy cutoff for this query."""
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    try:
        ranked = semantic_search_service.search(db, gallery_id, q, threshold=threshold)
    except semantic_search_service.SearchUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    return image_service.search_images(db, ranked, storage)


def _verify_image_in_gallery(db: Session, gallery_id: str, image_id: str):
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return image


@router.get("/{gallery_id}/images/{image_id}/comments", response_model=list[CommentResponse])
def admin_list_comments(
    gallery_id: str,
    image_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    _verify_image_in_gallery(db, gallery_id, image_id)
    return comment_service.list_comments(db, image_id)


@router.post("/{gallery_id}/images/{image_id}/comments", response_model=CommentResponse, status_code=201)
def admin_add_comment(
    gallery_id: str,
    image_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    _verify_image_in_gallery(db, gallery_id, image_id)
    return comment_service.add_comment(db, image_id, body)


@router.patch("/{gallery_id}/images/{image_id}/comments/{comment_id}", response_model=CommentResponse)
def admin_edit_comment(
    gallery_id: str,
    image_id: str,
    comment_id: str,
    body: CommentUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    _verify_image_in_gallery(db, gallery_id, image_id)
    return comment_service.edit_comment(db, gallery_id, image_id, comment_id, body)


@router.delete("/{gallery_id}/images/{image_id}/comments/{comment_id}", status_code=204)
def admin_delete_comment(
    gallery_id: str,
    image_id: str,
    comment_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    _verify_image_in_gallery(db, gallery_id, image_id)
    comment_service.delete_comment(db, gallery_id, image_id, comment_id, is_admin=True)


@router.post("/{gallery_id}/reorder", status_code=204)
def reorder_images(
    gallery_id: str,
    body: ReorderRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    image_service.reorder_images(db, gallery_id, body.image_ids)


@router.get("/{gallery_id}/votes/summary", response_model=VoteSummaryResponse)
def get_votes_summary(
    gallery_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    all_votes = vote_repo.get_all_for_gallery(db, gallery_id)
    reviewers: set[str] = set()
    images: dict[str, dict] = {}
    for v in all_votes:
        reviewers.add(v.reviewer_name)
        if v.image_id not in images:
            images[v.image_id] = {"totals": {"green": 0, "red": 0, "yellow": 0, "blue": 0, "none": 0}, "reviewers": {}}
        images[v.image_id]["reviewers"][v.reviewer_name] = v.color_flag
        images[v.image_id]["totals"][v.color_flag] = images[v.image_id]["totals"].get(v.color_flag, 0) + 1
    return VoteSummaryResponse(reviewers=sorted(reviewers), images=images)


@router.get("/{gallery_id}/activity", response_model=ActivityPage)
def get_activity(
    gallery_id: str,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    items, total = activity_repo.list_for_gallery(db, gallery_id, page=page, limit=limit)
    return ActivityPage(items=items, total=total, page=page, limit=limit)


_HEADER_IMG_MIMES = {"image/png", "image/jpeg", "image/webp"}


@router.post("/{gallery_id}/header-image", response_model=GalleryResponse)
def upload_header_image(
    gallery_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    mime = file.content_type or ""
    if mime not in _HEADER_IMG_MIMES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="PNG, JPEG, or WebP required")

    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[mime]
    filename = f"{uuid.uuid4()}{ext}"
    header_dir = os.path.join(app_settings.branding_dir, "gallery-headers", gallery_id)
    os.makedirs(header_dir, exist_ok=True)

    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    data = read_limited(file)
    assert_image_magic(data, mime)

    # Delete old header image
    if gallery.header_image_filename:
        old = os.path.join(header_dir, gallery.header_image_filename)
        if os.path.exists(old):
            os.unlink(old)

    with open(os.path.join(header_dir, filename), "wb") as f:
        f.write(data)

    gallery = gallery_repo.update(db, gallery, header_image_filename=filename)
    return gallery_service._build_response(gallery, db, storage)


@router.delete("/{gallery_id}/header-image", status_code=204)
def delete_header_image(
    gallery_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    if gallery.header_image_filename:
        header_dir = os.path.join(app_settings.branding_dir, "gallery-headers", gallery_id)
        old = os.path.join(header_dir, gallery.header_image_filename)
        if os.path.exists(old):
            os.unlink(old)
        gallery_repo.update(db, gallery, header_image_filename=None)


class FromImageRequest(BaseModel):
    image_id: str


@router.post("/{gallery_id}/header-image/from-image", response_model=GalleryResponse, status_code=200)
def set_header_image_from_gallery_image(
    gallery_id: str,
    body: FromImageRequest,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    header_dir = os.path.join(app_settings.branding_dir, "gallery-headers")
    image_service.use_image_as_header(db, gallery_id, body.image_id, storage, header_dir)
    gallery = gallery_repo.get_by_id(db, gallery_id)
    return gallery_service._build_response(gallery, db, storage)


@router.post("/{gallery_id}/cover-image", response_model=GalleryResponse)
def upload_cover_image(
    gallery_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    """Upload a custom cover/card image (e.g. for an empty gallery with no photo to use)."""
    mime = file.content_type or ""
    if mime not in _HEADER_IMG_MIMES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="PNG, JPEG, or WebP required")

    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[mime]
    filename = f"{uuid.uuid4()}{ext}"
    cover_dir = os.path.join(app_settings.branding_dir, "gallery-covers", gallery_id)
    os.makedirs(cover_dir, exist_ok=True)

    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    data = read_limited(file)
    assert_image_magic(data, mime)

    if gallery.cover_image_filename:
        old = os.path.join(cover_dir, gallery.cover_image_filename)
        if os.path.exists(old):
            os.unlink(old)

    with open(os.path.join(cover_dir, filename), "wb") as f:
        f.write(data)

    # Uploaded cover wins over a pinned photo cover; drop the pin so it's unambiguous.
    gallery = gallery_repo.update(db, gallery, cover_image_filename=filename, cover_image_id=None)
    return gallery_service._build_response(gallery, db, storage)


@router.delete("/{gallery_id}/cover-image", status_code=204)
def delete_cover_image(
    gallery_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    if gallery.cover_image_filename:
        cover_dir = os.path.join(app_settings.branding_dir, "gallery-covers", gallery_id)
        old = os.path.join(cover_dir, gallery.cover_image_filename)
        if os.path.exists(old):
            os.unlink(old)
        gallery_repo.update(db, gallery, cover_image_filename=None)


@router.get("/{gallery_id}/export")
def export_selections(
    gallery_id: str,
    flag: str | None = Query(default=None, description="Filter by flag color (green/red/yellow/blue)"),
    include_flag: bool = Query(default=False, description="Include flag color in each line"),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    content = gallery_service.export_flagged(db, gallery_id, flag=flag, include_flag=include_flag)
    filename = f"selections-{gallery_id[:8]}.txt"
    return Response(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
