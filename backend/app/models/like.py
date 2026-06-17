# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class ImageLike(Base):
    """One like per reviewer per image (the unique constraint enforces "one like per person").
    Mirrors ImageVote. The displayed count stays on Image.likes, maintained on toggle."""

    __tablename__ = "image_likes"
    __table_args__ = (UniqueConstraint("image_id", "reviewer_name", name="uq_image_likes_image_reviewer"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    image_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("images.id", ondelete="CASCADE"), nullable=False
    )
    gallery_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reviewer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
