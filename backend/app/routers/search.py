# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from typing import Literal

from app.auth.dependencies import get_current_admin
from app.database import get_db
from app.dependencies import get_storage
from app.schemas.image import GlobalSearchResult, PhotoPage
from app.services import image_service, semantic_search_service
from app.storage.base import StorageProvider

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search", response_model=list[GlobalSearchResult])
def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    threshold: float | None = Query(None, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    """Instance-wide semantic photo search (admin). Returns image hits across every gallery, each
    tagged with its gallery name + share token so the overview can badge and deep-link them.
    503 when the feature is off / the ML sidecar is unreachable."""
    try:
        ranked = semantic_search_service.search(db, None, q, threshold=threshold)
    except semantic_search_service.SearchUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    return image_service.global_search_images(db, ranked, storage)


@router.get("/photos", response_model=PhotoPage)
def all_photos(
    sort: Literal["date", "name"] = Query("date"),
    dir: Literal["asc", "desc"] = Query("desc"),
    q: str | None = Query(None, max_length=200),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    """Cross-gallery "All Photos" browser (admin) — every photo, sorted, paginated, each tagged with
    its gallery. Always available (no ML needed). Optional `q` filters by filename — the fallback
    "search" when semantic content search is off."""
    return image_service.list_all_photos(db, storage, sort, dir, limit, offset, name_filter=q)
