# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class ImageVote(Base):
    __tablename__ = "image_votes"
    __table_args__ = (UniqueConstraint("image_id", "reviewer_name", name="uq_image_votes_image_reviewer"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    image_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("images.id", ondelete="CASCADE"), nullable=False
    )
    gallery_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reviewer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    color_flag: Mapped[str] = mapped_column(String(10), nullable=False, default="none")
    # Per-reviewer 1–5 star rating (0 = cleared); the stars-mode parallel to color_flag.
    rating: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=_now, onupdate=_now)

    image: Mapped["Image"] = relationship("Image", back_populates="votes")  # noqa: F821
