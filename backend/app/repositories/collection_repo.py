# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.orm import Session

from app.models.collection import Collection, CollectionImage


def list_by_gallery(db: Session, gallery_id: str) -> list[Collection]:
    return db.execute(
        select(Collection)
        .where(Collection.gallery_id == gallery_id)
        .order_by(Collection.created_at)
    ).scalars().all()


def get(db: Session, collection_id: str) -> Collection | None:
    return db.execute(
        select(Collection).where(Collection.id == collection_id)
    ).scalar_one_or_none()


def create(db: Session, gallery_id: str, name: str, image_ids: list[str], created_by: str | None) -> Collection:
    collection = Collection(
        id=str(uuid.uuid4()),
        gallery_id=gallery_id,
        name=name,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    for pos, image_id in enumerate(image_ids):
        collection.members.append(CollectionImage(image_id=image_id, position=pos))
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return collection


def update_name(db: Session, collection: Collection, name: str) -> Collection:
    collection.name = name
    db.commit()
    db.refresh(collection)
    return collection


def replace_members(db: Session, collection: Collection, image_ids: list[str]) -> Collection:
    """Rewrite the membership in the given order (covers add / remove / reorder in one shot)."""
    collection.members.clear()  # cascade="all, delete-orphan" deletes the old rows
    db.flush()
    for pos, image_id in enumerate(image_ids):
        collection.members.append(CollectionImage(image_id=image_id, position=pos))
    db.commit()
    db.refresh(collection)
    return collection


def delete(db: Session, collection: Collection) -> None:
    db.delete(collection)
    db.commit()


def remove_images_from_gallery(db: Session, gallery_id: str, image_ids: list[str]) -> int:
    """Drop the given images from every collection of `gallery_id` (an image moved to another
    gallery must not linger — hidden — in the source's sets and reappear if moved back). Caller
    commits."""
    if not image_ids:
        return 0
    collection_ids = select(Collection.id).where(Collection.gallery_id == gallery_id)
    result = db.execute(
        sa_delete(CollectionImage).where(
            CollectionImage.collection_id.in_(collection_ids),
            CollectionImage.image_id.in_(image_ids),
        )
    )
    return result.rowcount or 0
