# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.comment import Comment


def list_by_image(db: Session, image_id: str) -> list[Comment]:
    return db.execute(
        select(Comment).where(Comment.image_id == image_id).order_by(Comment.created_at)
    ).scalars().all()


def create(db: Session, **kwargs) -> Comment:
    comment = Comment(**kwargs)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


def count_for_image(db: Session, image_id: str) -> int:
    return db.execute(
        select(func.count()).where(Comment.image_id == image_id)
    ).scalar_one()


def counts_for_images(db: Session, image_ids: list[str]) -> dict[str, int]:
    """Returns {image_id: comment_count} for all given image IDs in one query."""
    if not image_ids:
        return {}
    rows = db.execute(
        select(Comment.image_id, func.count(Comment.id))
        .where(Comment.image_id.in_(image_ids))
        .group_by(Comment.image_id)
    ).all()
    return {row[0]: row[1] for row in rows}


def anchored_counts_for_images(db: Session, image_ids: list[str]) -> dict[str, int]:
    """Returns {image_id: annotation_count} (comments carrying an anchor) in one query.

    Tests the JSON ``$.type`` so both SQL NULL and a stored JSON ``null`` (how older plain comments
    serialized) read as "not an annotation"."""
    if not image_ids:
        return {}
    rows = db.execute(
        select(Comment.image_id, func.count(Comment.id))
        .where(
            Comment.image_id.in_(image_ids),
            func.json_extract(Comment.anchor, "$.type").isnot(None),
        )
        .group_by(Comment.image_id)
    ).all()
    return {row[0]: row[1] for row in rows}


def get_by_id(db: Session, comment_id: str) -> Comment | None:
    return db.get(Comment, comment_id)


def delete(db: Session, comment: Comment) -> None:
    db.delete(comment)
    db.commit()


def update_text(db: Session, comment: Comment, text: str) -> Comment:
    comment.text = text
    db.commit()
    db.refresh(comment)
    return comment


def count_by_gallery(db: Session, gallery_id: str) -> int:
    """Total comment count across all non-deleted images in a gallery."""
    from app.models.image import Image
    return db.execute(
        select(func.count(Comment.id))
        .join(Image, Image.id == Comment.image_id)
        .where(Image.gallery_id == gallery_id, Image.deleted_at.is_(None))
    ).scalar_one()
