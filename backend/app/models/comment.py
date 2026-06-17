# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    image_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("images.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_name: Mapped[str] = mapped_column(String(255), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional spatial anchor → the comment is an annotation pinned to a region of the image.
    # NULL = an ordinary unanchored comment. Shape validated by schemas.comment.Anchor.
    # none_as_null so a plain comment stores SQL NULL (not JSON 'null'), keeping anchored counts clean.
    anchor: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)

    image: Mapped["Image"] = relationship("Image", back_populates="comments")  # noqa: F821
