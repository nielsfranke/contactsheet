# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.image import Image


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_by_gallery(db: Session, gallery_id: str, only_approved: bool = False) -> list[Image]:
    stmt = select(Image).where(Image.gallery_id == gallery_id, Image.deleted_at.is_(None))
    if only_approved:
        stmt = stmt.where(Image.moderation_status == "approved")
    return db.execute(stmt.order_by(Image.sort_order)).scalars().all()


def count_by_gallery(db: Session, gallery_id: str, only_approved: bool = False) -> int:
    """Live (non-deleted) image count for a gallery — a COUNT(*), not a full row load."""
    stmt = select(func.count()).select_from(Image).where(
        Image.gallery_id == gallery_id, Image.deleted_at.is_(None)
    )
    if only_approved:
        stmt = stmt.where(Image.moderation_status == "approved")
    return db.execute(stmt).scalar_one()


def get_by_id(db: Session, image_id: str) -> Image | None:
    return db.execute(
        select(Image).where(Image.id == image_id, Image.deleted_at.is_(None))
    ).scalar_one_or_none()


def create(db: Session, **kwargs) -> Image:
    image = Image(**kwargs)
    db.add(image)
    db.commit()
    db.refresh(image)
    return image


def increment_likes(db: Session, image_id: str) -> Image:
    db.execute(update(Image).where(Image.id == image_id).values(likes=Image.likes + 1))
    db.commit()
    return db.get(Image, image_id)


def update_fields(db: Session, image: Image, **kwargs) -> Image:
    for key, value in kwargs.items():
        setattr(image, key, value)
    db.commit()
    db.refresh(image)
    return image


def soft_delete(db: Session, image: Image) -> Image:
    image.deleted_at = _now()
    db.commit()
    return image


def set_sort_orders(db: Session, gallery_id: str, ordered_ids: list[str]) -> None:
    """Bulk-update sort_order for a list of image IDs in the given order."""
    for i, image_id in enumerate(ordered_ids):
        db.execute(
            update(Image)
            .where(Image.id == image_id, Image.gallery_id == gallery_id)
            .values(sort_order=i)
        )
    db.commit()


def update_processing_result(
    db: Session,
    image_id: str,
    *,
    width: int,
    height: int,
    exif_data: str | None,
    iptc_data: str | None,
    status: str,
) -> None:
    db.execute(
        update(Image)
        .where(Image.id == image_id)
        .values(
            width=width,
            height=height,
            exif_data=exif_data,
            iptc_data=iptc_data,
            processing_status=status,
        )
    )
    db.commit()


def set_processing_error(db: Session, image_id: str) -> None:
    db.execute(
        update(Image).where(Image.id == image_id).values(processing_status="error")
    )
    db.commit()
