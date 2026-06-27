# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.database import get_db
from app.dependencies import get_storage
from app.schemas.collection import CollectionCreate, CollectionResponse, CollectionUpdate
from app.services import collection_service
from app.storage.base import StorageProvider

router = APIRouter(prefix="/api/galleries", tags=["collections"])


@router.get("/{gallery_id}/collections", response_model=list[CollectionResponse])
def list_collections(
    gallery_id: str,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return collection_service.list_collections(db, gallery_id, storage)


@router.post("/{gallery_id}/collections", response_model=CollectionResponse, status_code=201)
def create_collection(
    gallery_id: str,
    body: CollectionCreate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return collection_service.create_collection(db, gallery_id, body, storage)


@router.patch("/{gallery_id}/collections/{collection_id}", response_model=CollectionResponse)
def update_collection(
    gallery_id: str,
    collection_id: str,
    body: CollectionUpdate,
    db: Session = Depends(get_db),
    storage: StorageProvider = Depends(get_storage),
    _admin: str = Depends(get_current_admin),
):
    return collection_service.update_collection(
        db, gallery_id, collection_id, body, storage, is_admin=True
    )


@router.delete("/{gallery_id}/collections/{collection_id}", status_code=204)
def delete_collection(
    gallery_id: str,
    collection_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    collection_service.delete_collection(db, gallery_id, collection_id, is_admin=True)
