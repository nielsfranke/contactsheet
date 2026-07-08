# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class Gallery(Base):
    __tablename__ = "galleries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("galleries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    share_token: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, default=_uuid, index=True)
    # Standalone access: when true this gallery is a navigation boundary for clients — its parent
    # and ancestors are not exposed, so a shared sub-gallery can't reveal the parent or siblings.
    hide_parent_nav: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="presentation")
    # Showcase-only opt-in: clients may switch this gallery into the Review experience themselves.
    # Enabling it opens the review write endpoints for the gallery (same trust model as Review
    # mode); ignored when mode is already "collaboration".
    client_mode_switch_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    layout: Mapped[str] = mapped_column(String(20), nullable=False, default="grid")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Admin-only favorite flag: pinned galleries surface in a shelf atop the overview. Never
    # cascades to sub-galleries, never affects the public gallery.
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    tags: Mapped[str] = mapped_column(Text, nullable=False, default="[]")               # JSON array
    watermark_settings: Mapped[str | None] = mapped_column(Text, nullable=True)         # JSON object
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    downloads_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    enable_team_voting: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    headline: Mapped[str | None] = mapped_column(Text, nullable=True)
    header_image_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    header_focus_x: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)
    header_focus_y: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)
    cover_image_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Uploaded cover image (independent of gallery photos) — takes precedence over cover_image_id.
    cover_image_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Per-mode look & behaviour templates that NEW sub-galleries inherit by mode (reuses the
    # GalleryPreset shape): {"presentation": {...}, "collaboration": {...}}. Null = no override →
    # a divergent-mode sub-gallery falls back to the instance preset. Inherited on create +
    # cascadable, so a container can define a "Showcase look" and a "Review look" for its subtree.
    # See docs/proposals/gallery-per-container-mode-presets.md.
    subgallery_presets: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Presentation (public gallery look)
    opener_font: Mapped[str] = mapped_column(String(40), nullable=False, default="sans")
    opener_font_size: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    # Anchor of the title over the presentation hero image (e.g. "top-left", "center").
    opener_title_position: Mapped[str] = mapped_column(String(20), nullable=False, default="center")
    # Showcase hero legibility: dark scrim over the header image (default on), and an optional
    # stronger drop-shadow on the title/subtitle (for a bright header shown without the scrim).
    opener_scrim: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    opener_title_shadow: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    preview_size: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    preview_spacing: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    preview_corners: Mapped[str] = mapped_column(String(10), nullable=False, default="round")
    bg_brightness: Mapped[str] = mapped_column(String(10), nullable=False, default="dark")
    bg_dimmed_color: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Collaboration feature toggles
    color_flags_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    likes_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    comments_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    annotations_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # anchored comment pins (Feature 8)
    sets_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)        # Collections (built)
    client_upload_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # client uploads (built)
    # Require photographer approval before client uploads become public (approval queue).
    client_upload_moderation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    show_filename: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    show_filename_lightbox: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    show_exif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    show_iptc: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Per-gallery notifications master switch (operational, never cascades, never public).
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=_now, onupdate=_now)

    # Relationships
    children: Mapped[list["Gallery"]] = relationship(
        "Gallery", foreign_keys=[parent_id], back_populates="parent", lazy="select"
    )
    parent: Mapped["Gallery | None"] = relationship(
        "Gallery", foreign_keys=[parent_id], back_populates="children", remote_side=[id]
    )
    images: Mapped[list["Image"]] = relationship(  # noqa: F821
        "Image", back_populates="gallery", lazy="select"
    )
