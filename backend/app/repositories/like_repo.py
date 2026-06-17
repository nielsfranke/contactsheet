# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy import case, delete, select, update
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
    db.commit()
    return True


def reassign_gallery(db: Session, image_id: str, gallery_id: str) -> None:
    """Move an image's like rows to a new gallery (keeps per-reviewer likes consistent on move)."""
    db.execute(update(ImageLike).where(ImageLike.image_id == image_id).values(gallery_id=gallery_id))
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
