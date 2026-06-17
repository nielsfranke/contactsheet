# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class ZipJob(Base):
    __tablename__ = "zip_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gallery_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    filter_type: Mapped[str] = mapped_column(String(20), nullable=False, default="all")
    image_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
