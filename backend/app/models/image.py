# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class Image(Base):
    __tablename__ = "images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gallery_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("galleries.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(100), nullable=False)  # {uuid}.{ext}

    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(50), nullable=False)

    exif_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    iptc_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON (IPTC-IIM editorial metadata)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)

    color_flag: Mapped[str] = mapped_column(String(10), nullable=False, default="none")
    # Shared 1–5 star rating (0 = unrated); the stars-mode parallel to color_flag.
    rating: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    likes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Reviewer name of a public client uploader; null for photographer (admin) uploads.
    uploaded_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Moderation gate for client uploads: "approved" (visible to the public) | "pending" (awaiting
    # the photographer's review in a gallery with client_upload_moderation on). Admin uploads and
    # legacy rows are always "approved". Rejecting a pending upload soft-deletes it (no third value).
    moderation_status: Mapped[str] = mapped_column(String(10), nullable=False, default="approved")
    tags: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON array

    is_video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    video_poster_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Processing pipeline status
    processing_status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    # values: "pending" | "done" | "error"

    # Semantic-search index status (only acted on when the feature is enabled):
    # "pending" | "indexed" | "skipped" (video / unencodable) | "error".
    embedding_status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_now)

    gallery: Mapped["Gallery"] = relationship("Gallery", back_populates="images")  # noqa: F821
    comments: Mapped[list["Comment"]] = relationship(  # noqa: F821
        "Comment", back_populates="image", lazy="select", cascade="all, delete-orphan"
    )
    annotations: Mapped[list["Annotation"]] = relationship(  # noqa: F821
        "Annotation", back_populates="image", lazy="select", cascade="all, delete-orphan"
    )
    votes: Mapped[list["ImageVote"]] = relationship(  # noqa: F821
        "ImageVote", back_populates="image", lazy="select", cascade="all, delete-orphan"
    )
