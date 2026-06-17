# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.errors import CodedHTTPException
from app.models.collection import Collection
from app.models.image import Image
from app.realtime import publish as realtime_publish
from app.repositories import activity_repo, collection_repo, gallery_repo, image_repo
from app.schemas.collection import CollectionCreate, CollectionResponse, CollectionUpdate
from app.services import notification_service
from app.storage.base import StorageProvider


def _authorize(collection: Collection, actor: str | None, is_admin: bool) -> None:
    """Admin may modify any collection; a public client only those they created (reviewer-name
    match). Mirrors the comment/annotation author-match trust model."""
    if is_admin:
        return
    if not collection.created_by or collection.created_by != (actor or "").strip():
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            code="collection_forbidden",
            detail="You can only modify collections you created",
        )


def _thumb_url(gallery_id: str, image: Image, storage: StorageProvider) -> str | None:
    if image.processing_status != "done":
        return None
    return storage.get_url(f"{gallery_id}/thumb/{image.stored_filename}")


def _to_response(collection: Collection, live: dict[str, Image], storage: StorageProvider) -> CollectionResponse:
    # Members are ordered by position; drop any whose image was (soft-)deleted.
    ordered = [m.image_id for m in collection.members if m.image_id in live]
    cover_url = _thumb_url(collection.gallery_id, live[ordered[0]], storage) if ordered else None
    return CollectionResponse(
        id=collection.id,
        gallery_id=collection.gallery_id,
        name=collection.name,
        created_by=collection.created_by,
        image_ids=ordered,
        image_count=len(ordered),
        cover_url=cover_url,
        created_at=collection.created_at,
    )


def _live_images(db: Session, gallery_id: str) -> dict[str, Image]:
    return {img.id: img for img in image_repo.get_by_gallery(db, gallery_id)}


def list_collections(db: Session, gallery_id: str, storage: StorageProvider) -> list[CollectionResponse]:
    live = _live_images(db, gallery_id)
    return [_to_response(c, live, storage) for c in collection_repo.list_by_gallery(db, gallery_id)]


def create_collection(
    db: Session,
    gallery_id: str,
    data: CollectionCreate,
    storage: StorageProvider,
    created_by: str | None = None,
) -> CollectionResponse:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Collection name is required")

    live = _live_images(db, gallery_id)
    # Keep only ids that belong to this gallery (preserve request order, drop dupes).
    seen: set[str] = set()
    image_ids = [iid for iid in data.image_ids if iid in live and not (iid in seen or seen.add(iid))]
    if not image_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid images for this collection")

    collection = collection_repo.create(db, gallery_id, name, image_ids, created_by)
    try:
        activity_repo.log(db, gallery_id, "collection", created_by or "Admin", meta={"name": name})
    except Exception:
        pass
    # Notify only on client-made collections (created_by set); the admin's own don't self-notify.
    if created_by:
        notification_service.enqueue(db, gallery_id, "collection", created_by, meta={"name": name})
    realtime_publish(gallery_id, "collection")
    return _to_response(collection, live, storage)


def update_collection(
    db: Session,
    gallery_id: str,
    collection_id: str,
    data: CollectionUpdate,
    storage: StorageProvider,
    *,
    actor: str | None = None,
    is_admin: bool = False,
) -> CollectionResponse:
    collection = collection_repo.get(db, collection_id)
    if not collection or collection.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    _authorize(collection, actor, is_admin)

    if data.name is None and data.image_ids is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to update")

    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Collection name is required")
        collection_repo.update_name(db, collection, name)

    live = _live_images(db, gallery_id)
    if data.image_ids is not None:
        # Keep only ids that belong to this gallery (preserve order, drop dupes); a collection must
        # retain at least one member (consistent with create).
        seen: set[str] = set()
        image_ids = [iid for iid in data.image_ids if iid in live and not (iid in seen or seen.add(iid))]
        if not image_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid images for this collection")
        collection_repo.replace_members(db, collection, image_ids)

    realtime_publish(gallery_id, "collection")
    return _to_response(collection, live, storage)


def delete_collection(
    db: Session, gallery_id: str, collection_id: str, *, actor: str | None = None, is_admin: bool = False
) -> None:
    collection = collection_repo.get(db, collection_id)
    if not collection or collection.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    _authorize(collection, actor, is_admin)
    collection_repo.delete(db, collection)
    realtime_publish(gallery_id, "collection")
