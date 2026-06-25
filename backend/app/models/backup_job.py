# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class BackupJob(Base):
    """An async, on-disk full-instance backup build. Mirrors ``ZipJob`` but kept as a
    separate table so its TTL/cleanup lifecycle stays independent of the aggressive
    ZIP-export clock. See docs/architecture/backup-restore.md."""

    __tablename__ = "backup_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    scope: Mapped[str] = mapped_column(String(10), nullable=False, default="full")  # full | metadata
    include_renditions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
