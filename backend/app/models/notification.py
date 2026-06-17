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


class NotificationOutbox(Base):
    """Pending notification events, drained by the in-process flusher (notification_service).

    One row per notifiable event. The flusher groups unsent rows per gallery, sends one
    coalesced message per channel, then stamps ``sent_at``.
    """

    __tablename__ = "notification_outbox"
    __table_args__ = (
        Index("ix_notification_outbox_pending", "sent_at", "gallery_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gallery_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False
    )
    # comment / collection / flag / view
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
