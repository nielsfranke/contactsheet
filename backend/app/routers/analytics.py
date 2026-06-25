# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.database import get_db
from app.dependencies import get_storage
from app.repositories import gallery_repo
from app.schemas.analytics import GalleryAnalytics, InstanceAnalytics
from app.services import analytics_service
from app.storage.base import StorageProvider

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/galleries/{gallery_id}/analytics", response_model=GalleryAnalytics)
def gallery_analytics(
    gallery_id: str,
    days: int = Query(default=30, ge=1, le=365),
    tz_offset_minutes: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    if gallery_repo.get_by_id(db, gallery_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    return analytics_service.gallery_analytics(db, storage, gallery_id, days, tz_offset_minutes)


@router.get("/admin/analytics", response_model=InstanceAnalytics)
def instance_analytics(
    days: int = Query(default=30, ge=1, le=365),
    tz_offset_minutes: int = Query(default=0, ge=-840, le=840),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    return analytics_service.instance_analytics(db, days, tz_offset_minutes)
