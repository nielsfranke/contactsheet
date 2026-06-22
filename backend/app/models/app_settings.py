# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy import JSON, Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    instance_name: Mapped[str] = mapped_column(String(255), nullable=False, default="ContactSheet")
    accent_color: Mapped[str] = mapped_column(String(20), nullable=False, default="#000000")
    # Render accent-filled primary CTAs as a subtle gradient (derived from accent_color in CSS).
    accent_gradient: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    logo_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    admin_theme: Mapped[str] = mapped_column(String(10), nullable=False, default="light")
    # Admin UI language (BCP-47 short code). Source of truth for the photographer's locale; the
    # frontend mirrors it to the NEXT_LOCALE cookie for SSR. Public clients are auto-detected.
    admin_locale: Mapped[str] = mapped_column(String(10), nullable=False, default="en")

    # Admin masthead branding (the top-left box). brand_display: "logo_name" / "logo_only" /
    # "name_only". brand_font is a gallery-font registry key; brand_color a hex (None = theme fg).
    brand_display: Mapped[str] = mapped_column(String(20), nullable=False, default="logo_name")
    brand_font: Mapped[str] = mapped_column(String(40), nullable=False, default="sans")
    brand_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tagline: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Public origin for client share links (e.g. behind a reverse proxy). None = use request host.
    public_base_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Source-code repository URL offered to users (AGPL §13). None = upstream default (frontend).
    source_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Public lightbox backdrop tone: "dimmed" (black/95, default), "black", "white", "transparent".
    lightbox_backdrop: Mapped[str] = mapped_column(String(20), nullable=False, default="dimmed")

    # High-resolution renditions (800px thumbs / 2560px mediums) vs. the lighter
    # 300px / 1920px set; toggling regenerates existing files in the background.
    high_res_previews: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Instance-wide rating style: "flags" (color flags) | "stars" (1–5). Switches the whole
    # instance between the two; never both. Stars and flags are stored in separate columns so
    # switching is non-destructive.
    rating_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="flags")

    # Default look & behaviour for newly created galleries, one preset per mode.
    # None = built-in model defaults; shape is validated by schemas.settings.GalleryPreset.
    preset_presentation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    preset_collaboration: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Admin-only view preferences (never affect the public gallery).
    # "mirror" = admin photo grid follows each gallery's client look (WYSIWYG); "custom" = use
    # admin_grid_view. admin_grid_view is a look blob (shape: schemas.settings.AdminGridView);
    # None = built-in defaults.
    admin_grid_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="mirror")
    admin_grid_view: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Gallery-overview grid (/admin/galleries) look & order.
    overview_size: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    overview_shape: Mapped[str] = mapped_column(String(10), nullable=False, default="square")
    overview_spacing: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    overview_corners: Mapped[str] = mapped_column(String(10), nullable=False, default="round")
    overview_sort: Mapped[str] = mapped_column(String(20), nullable=False, default="created")
    # Direction of overview_sort / left-tree order: "asc" or "desc". Default newest-first.
    overview_sort_dir: Mapped[str] = mapped_column(String(4), nullable=False, default="desc")
    # Instance-wide default photo sort for galleries (sticky: the admin in-gallery view writes
    # this back on change; the client gallery seeds its initial sort from it). Keys mirror the
    # toolbar: manual / filename / date / captured.
    gallery_sort: Mapped[str] = mapped_column(String(12), nullable=False, default="captured")
    gallery_sort_dir: Mapped[str] = mapped_column(String(4), nullable=False, default="asc")

    # Public gallery branding footer (business name, website, contact/social links).
    # footer holds the content blob (shape: schemas.settings.FooterSettings); None = unset.
    footer_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    footer: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Notifications config blob (shape: schemas.notifications.NotificationSettings); None = unset.
    # Holds the global master switch, per-event-type toggles, and the Apprise channel list.
    notifications: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Semantic content-search config blob (shape: schemas.settings.SemanticSearchSettings);
    # None = unset/off. Holds the master switch, encoder model name, and default threshold.
    # Off by default — indexing and the ML sidecar only run once an admin opts in.
    semantic_search: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Activity-log IP capture (privacy-sensitive — off by default). When on, public events
    # (view/download/upload) store the client IP; gallery opens are also logged (deduped per IP).
    # IPs are scrubbed to NULL after `activity_ip_retention_days`.
    activity_ip_logging: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    activity_ip_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)

    # Setup wizard
    setup_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    admin_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    admin_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    secret_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Admin session generation. Embedded as the "ver" claim in admin JWTs; bumping it (via
    # "sign out everywhere") invalidates every previously issued admin token at once. Held in
    # runtime_config after startup so the auth dependency needs no per-request DB read.
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
