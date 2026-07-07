# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin, require_scope
from app.database import get_db
from app.rate_limit import limiter
from app.dependencies import get_storage
from app.errors import CodedHTTPException
from app.repositories import comment_repo, gallery_repo, image_repo
from app.schemas.gallery import GalleryUpdate
from app.schemas.image import (
    CheckDuplicatesRequest,
    CheckDuplicatesResponse,
    ImageResponse,
    ImageUpdate,
    ReorderRequest,
    UploadResponse,
)
from app.services import gallery_service, image_service, watermark_service
from app.storage.base import StorageProvider
from app.utils import assert_image_magic, read_limited

router = APIRouter(prefix="/api", tags=["images"])

# Duplicate-resolution actions accepted per filename on upload.
_DUPLICATE_ACTIONS = {"replace", "keep_both", "skip"}


def _parse_duplicate_actions(raw: str | None) -> dict[str, str] | None:
    """Parse the optional `duplicate_actions` upload form field: a JSON object mapping a filename to
    one of replace/keep_both/skip. Absent/blank → None (legacy silent-append). Malformed → 400."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="upload_bad_duplicate_actions",
            detail="duplicate_actions must be a JSON object",
        )
    if not isinstance(parsed, dict) or any(v not in _DUPLICATE_ACTIONS for v in parsed.values()):
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="upload_bad_duplicate_actions",
            detail="duplicate_actions values must be one of: replace, keep_both, skip",
        )
    return {str(k): str(v) for k, v in parsed.items()}


@router.post("/galleries/{gallery_id}/images/check-duplicates", response_model=CheckDuplicatesResponse)
def check_duplicate_filenames(
    gallery_id: str,
    body: CheckDuplicatesRequest,
    db: Session = Depends(get_db),
    _auth: str = Depends(require_scope("images:write")),
):
    """Pre-flight for the upload dialog: which candidate filenames already exist (live) in the gallery."""
    return CheckDuplicatesResponse(
        duplicates=image_service.check_duplicates(db, gallery_id, body.filenames)
    )


@router.post("/galleries/{gallery_id}/images", response_model=list[UploadResponse], status_code=201)
@limiter.limit("120/minute")
def upload_images(
    request: Request,
    gallery_id: str,
    files: list[UploadFile] = File(...),
    duplicate_actions: str | None = Form(None),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _auth: str = Depends(require_scope("images:write")),
):
    return image_service.upload_images(
        db, gallery_id, files, storage,
        duplicate_actions=_parse_duplicate_actions(duplicate_actions),
    )


@router.patch("/images/{image_id}", response_model=ImageResponse)
def update_image(
    image_id: str,
    body: ImageUpdate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    image = image_service.update_image(db, image_id, body)
    count = comment_repo.count_for_image(db, image_id)
    return image_service._image_to_response(image, storage, include_original_url=True, comment_count=count)


@router.post("/galleries/{gallery_id}/reorder", status_code=204)
def reorder_images(
    gallery_id: str,
    body: ReorderRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    image_repo.set_sort_orders(db, gallery_id, body.image_ids)


@router.delete("/images/{image_id}", status_code=204)
def delete_image(
    image_id: str,
    db: Session = Depends(get_db),
    _auth: str = Depends(require_scope("images:write")),
):
    # images:write (admin cookie OR PAT) — the Lightroom publish service deletes the
    # old server image when re-publishing an edited photo and on remove-from-collection.
    image_service.delete_image(db, image_id)


@router.post("/galleries/{gallery_id}/images/{image_id}/approve", response_model=ImageResponse)
def approve_image(
    gallery_id: str,
    image_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    image = image_service.approve_image(db, image_id)
    count = comment_repo.count_for_image(db, image_id)
    return image_service._image_to_response(image, storage, include_original_url=True, comment_count=count)


class ApproveImagesRequest(BaseModel):
    image_ids: list[str]


@router.post("/galleries/{gallery_id}/images/approve")
def approve_images(
    gallery_id: str,
    body: ApproveImagesRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    approved = image_service.approve_images(db, gallery_id, body.image_ids)
    return {"approved": approved}


class MoveImageRequest(BaseModel):
    target_gallery_id: str


@router.post("/images/{image_id}/move", response_model=ImageResponse)
def move_image(
    image_id: str,
    body: MoveImageRequest,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    image = image_service.move_image(db, image_id, body.target_gallery_id, storage)
    count = comment_repo.count_for_image(db, image_id)
    return image_service._image_to_response(image, storage, include_original_url=True, comment_count=count)


@router.post("/galleries/{gallery_id}/watermark")
def upload_watermark(
    gallery_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    mime = file.content_type or ""
    if mime not in ("image/png", "image/webp"):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="PNG or WebP required")

    ext = {
        "image/png": ".png",
        "image/webp": ".webp",
    }[mime]

    data = read_limited(file)
    assert_image_magic(data, mime)
    filename = watermark_service.save_watermark(gallery_id, data, ext)

    existing: dict = {}
    if gallery.watermark_settings:
        try:
            existing = json.loads(gallery.watermark_settings)
        except Exception:
            pass

    existing["filename"] = filename
    gallery_service.update_gallery(
        db, gallery_id,
        GalleryUpdate.model_validate({"watermark_settings": json.dumps(existing)}),
        storage,
    )
    return {"filename": filename}


@router.delete("/galleries/{gallery_id}/watermark", status_code=204)
def delete_watermark(
    gallery_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    if gallery.watermark_settings:
        try:
            ws = json.loads(gallery.watermark_settings)
            if ws.get("filename"):
                watermark_service.delete_watermark(gallery_id, ws["filename"])
                ws["filename"] = None
                gallery_service.update_gallery(
                    db, gallery_id,
                    GalleryUpdate.model_validate({"watermark_settings": json.dumps(ws)}),
                    storage,
                )
        except Exception:
            pass
