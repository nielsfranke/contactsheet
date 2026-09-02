# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy import case, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.image import Image
from app.models.like import ImageLike


def toggle(db: Session, image_id: str, gallery_id: str, reviewer_name: str) -> bool:
    """Toggle this reviewer's like on the image. Maintains the denormalised Image.likes count
    (floored at 0). Returns the new liked state (True = now liked)."""
    existing = db.scalar(
        select(ImageLike).where(
            ImageLike.image_id == image_id, ImageLike.reviewer_name == reviewer_name
        )
    )
    if existing:
        db.delete(existing)
        db.execute(
            update(Image)
            .where(Image.id == image_id)
            .values(likes=case((Image.likes > 0, Image.likes - 1), else_=0))
        )
        db.commit()
        return False

    db.add(ImageLike(image_id=image_id, gallery_id=gallery_id, reviewer_name=reviewer_name))
    db.execute(update(Image).where(Image.id == image_id).values(likes=Image.likes + 1))
    try:
        db.commit()
    except IntegrityError:
        # Two taps raced past the SELECT above; the other one won — the like exists, count is right.
        db.rollback()
    return True


def reassign_gallery(db: Session, image_id: str, gallery_id: str) -> None:
    """Move an image's like rows to a new gallery (keeps per-reviewer likes consistent on move)."""
    db.execute(update(ImageLike).where(ImageLike.image_id == image_id).values(gallery_id=gallery_id))
    db.commit()


def reassign_gallery_bulk(db: Session, image_ids: list[str], gallery_id: str) -> None:
    """Bulk variant of reassign_gallery for multi-image transfers — one UPDATE, one commit."""
    if not image_ids:
        return
    db.execute(
        update(ImageLike)
        .where(ImageLike.image_id.in_(image_ids))
        .values(gallery_id=gallery_id)
        .execution_options(synchronize_session=False)
    )
    db.commit()


def liked_image_ids(db: Session, gallery_id: str, reviewer_name: str) -> list[str]:
    """Image ids in the gallery this reviewer has liked."""
    return list(
        db.scalars(
            select(ImageLike.image_id).where(
                ImageLike.gallery_id == gallery_id, ImageLike.reviewer_name == reviewer_name
            )
        )
    )
