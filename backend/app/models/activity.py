# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (Index("ix_activities_gallery", "gallery_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gallery_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False
    )
    image_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("images.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    author: Mapped[str] = mapped_column(String(255), nullable=False)
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Client IP for public events (view/download/upload), captured only while IP logging is on;
    # scrubbed to NULL after the configured retention. Always NULL for admin-side actions.
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
