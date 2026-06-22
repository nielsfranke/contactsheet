# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.vote import ImageVote


def reassign_gallery(db: Session, image_id: str, gallery_id: str) -> None:
    """Move an image's vote rows to a new gallery (keeps per-reviewer votes consistent on move)."""
    db.execute(update(ImageVote).where(ImageVote.image_id == image_id).values(gallery_id=gallery_id))
    db.commit()


def get_votes_for_reviewer(db: Session, gallery_id: str, reviewer_name: str) -> list[ImageVote]:
    return db.execute(
        select(ImageVote).where(
            ImageVote.gallery_id == gallery_id,
            ImageVote.reviewer_name == reviewer_name,
        )
    ).scalars().all()


def get_all_for_gallery(db: Session, gallery_id: str) -> list[ImageVote]:
    return db.execute(
        select(ImageVote).where(ImageVote.gallery_id == gallery_id)
    ).scalars().all()


def upsert(
    db: Session,
    image_id: str,
    gallery_id: str,
    reviewer_name: str,
    color_flag: str | None = None,
    rating: int | None = None,
) -> ImageVote:
    """Set this reviewer's flag and/or star for an image. Only the field(s) supplied are written,
    so a stars-mode reviewer updates `rating` without clobbering a stored `color_flag` (and vice
    versa) — the row carries both, the active rating_mode decides which is shown."""
    now = datetime.now(timezone.utc)

    def _apply(vote: ImageVote) -> None:
        if color_flag is not None:
            vote.color_flag = color_flag
        if rating is not None:
            vote.rating = rating
        vote.updated_at = now

    existing = db.execute(
        select(ImageVote).where(
            ImageVote.image_id == image_id,
            ImageVote.reviewer_name == reviewer_name,
        )
    ).scalar_one_or_none()

    if existing:
        _apply(existing)
        db.commit()
        db.refresh(existing)
        return existing

    vote = ImageVote(
        id=str(uuid.uuid4()),
        image_id=image_id,
        gallery_id=gallery_id,
        reviewer_name=reviewer_name,
        color_flag=color_flag if color_flag is not None else "none",
        rating=rating if rating is not None else 0,
        created_at=now,
        updated_at=now,
    )
    db.add(vote)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.execute(
            select(ImageVote).where(
                ImageVote.image_id == image_id,
                ImageVote.reviewer_name == reviewer_name,
            )
        ).scalar_one()
        _apply(existing)
        db.commit()
        db.refresh(existing)
        return existing
    db.refresh(vote)
    return vote
