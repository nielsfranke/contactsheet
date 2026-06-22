# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator


LayoutType = Literal["grid", "masonry", "list"]
ModeType = Literal["presentation", "collaboration"]
# Opener heading font. Legacy aliases "sans"/"serif"/"mono" are kept for backward
# compatibility; the named keys mirror the registry in
# frontend/src/lib/gallery-fonts.ts (keep both lists in sync).
FontType = Literal[
    "sans",
    "serif",
    "mono",
    # Sans Serif
    "inter",
    "source-sans-3",
    "manrope",
    "signika",
    "merriweather-sans",
    "montserrat",
    # Serif
    "merriweather",
    "lora",
    "libre-baskerville",
    # Display / Script
    "bebas-neue",
    "abril-fatface",
    "poiret-one",
    "amatic-sc",
    "oleo-script",
    "pacifico",
    "pinyon-script",
    "dancing-script",
    # Mono
    "jetbrains-mono",
    # Accessibility
    "atkinson-next",
    "atkinson-mono",
    "opendyslexic",
    "dejavu-sans",
    "dejavu-sans-mono",
]
SizeType = Literal["small", "medium", "large"]
CornersType = Literal["round", "square"]
BrightnessType = Literal["bright", "dark"]


# Contact/social icon keys, in their default display order.
FOOTER_ICON_KEYS = ("email", "phone", "instagram", "facebook", "x", "tiktok", "youtube", "linkedin")


class FooterSettings(BaseModel):
    """Public gallery branding footer content (one global instance footer).

    Every field is optional — empty/absent means "don't render". URLs are stored as entered and
    normalized at render time. Defined here (not in schemas.settings) so the public gallery
    response can embed it without a circular import.
    """

    model_config = {"extra": "forbid"}

    business_name: str | None = Field(default=None, max_length=255)
    website_url: str | None = Field(default=None, max_length=500)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=64)
    instagram: str | None = Field(default=None, max_length=500)
    facebook: str | None = Field(default=None, max_length=500)
    x: str | None = Field(default=None, max_length=500)
    tiktok: str | None = Field(default=None, max_length=500)
    youtube: str | None = Field(default=None, max_length=500)
    linkedin: str | None = Field(default=None, max_length=500)
    # Display order of the contact/social icons (subset/superset tolerated; unknown keys dropped,
    # missing keys fall back to FOOTER_ICON_KEYS order at render time).
    icon_order: list[str] | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _blank_to_none(cls, v):
        # Treat empty/whitespace strings as unset so they don't render as empty icons.
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str | None) -> str | None:
        if v and "@" not in v:
            raise ValueError("Email must contain @")
        return v

    @field_validator("icon_order")
    @classmethod
    def _clean_icon_order(cls, v: list[str] | None) -> list[str] | None:
        # Keep only known icon keys, de-duplicated, preserving the given order.
        if not v:
            return None
        seen: list[str] = []
        for k in v:
            if k in FOOTER_ICON_KEYS and k not in seen:
                seen.append(k)
        return seen or None


class GalleryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    parent_id: str | None = None
    password: str | None = None
    mode: ModeType = "presentation"
    layout: LayoutType = "grid"
    sort_order: int = 0
    downloads_enabled: bool = True
    enable_team_voting: bool = False
    headline: str | None = Field(default=None, max_length=512)
    expires_at: datetime | None = None


class GalleryDerive(BaseModel):
    """Create a new gallery from a set of images of an existing gallery (collection / filter /
    selection). `parent_id` null = top-level, or the source gallery id for a sub-gallery."""

    name: str = Field(..., min_length=1, max_length=255)
    image_ids: list[str] = Field(..., min_length=1)
    parent_id: str | None = None
    operation: Literal["copy", "move"] = "copy"


class GalleryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    # None = don't touch, "" = remove password, non-empty = set new password
    password: str | None = None
    mode: ModeType | None = None
    layout: LayoutType | None = None
    sort_order: int | None = None
    pinned: bool | None = None              # admin favorite flag (never cascades)
    downloads_enabled: bool | None = None
    enable_team_voting: bool | None = None
    hide_parent_nav: bool | None = None     # standalone access — clients can't navigate to the parent
    watermark_settings: str | None = None   # JSON string, internal use
    headline: str | None = None             # "" = clear, non-empty = set
    expires_at: datetime | None = None      # None = no change; use explicit sentinel below

    # Presentation
    opener_font: FontType | None = None
    opener_font_size: SizeType | None = None
    preview_size: SizeType | None = None
    preview_spacing: SizeType | None = None
    preview_corners: CornersType | None = None
    bg_brightness: BrightnessType | None = None
    bg_dimmed_color: str | None = Field(default=None, max_length=20)

    # Collaboration feature toggles
    color_flags_enabled: bool | None = None
    likes_enabled: bool | None = None
    comments_enabled: bool | None = None
    annotations_enabled: bool | None = None
    sets_enabled: bool | None = None
    client_upload_enabled: bool | None = None
    client_upload_moderation: bool | None = None
    show_filename: bool | None = None
    show_filename_lightbox: bool | None = None
    show_exif: bool | None = None
    show_iptc: bool | None = None

    # Per-gallery notifications master switch (operational, never cascades)
    notifications_enabled: bool | None = None

    # cover_image_id: None = don't touch; explicit UUID = pin; explicit "" = clear
    cover_image_id: str | None = Field(default=None, max_length=36)

    # Header image focus point (0–100 each axis); None = don't touch
    header_focus_x: float | None = Field(default=None, ge=0, le=100)
    header_focus_y: float | None = Field(default=None, ge=0, le=100)

    # Cascade these settings to all descendant galleries
    apply_to_subgalleries: bool = False


class GalleryMove(BaseModel):
    # None = move to top level; a gallery id = nest under that (root) gallery.
    target_parent_id: str | None = None


class ShareTokenUpdate(BaseModel):
    strategy: Literal["named", "random", "custom"]
    value: str | None = None  # required for "custom"


class GalleryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    parent_id: str | None
    name: str
    description: str
    has_password: bool
    share_token: str
    mode: str
    layout: str
    sort_order: int
    pinned: bool = False
    downloads_enabled: bool
    enable_team_voting: bool = False
    hide_parent_nav: bool = False
    watermark_settings: str | None = None
    headline: str | None = None
    header_image_url: str | None = None
    expires_at: datetime | None

    # Presentation
    opener_font: str = "sans"
    opener_font_size: str = "medium"
    preview_size: str = "medium"
    preview_spacing: str = "medium"
    preview_corners: str = "round"
    bg_brightness: str = "dark"
    bg_dimmed_color: str | None = None

    # Collaboration feature toggles
    color_flags_enabled: bool = True
    likes_enabled: bool = False
    comments_enabled: bool = True
    annotations_enabled: bool = False
    sets_enabled: bool = False
    client_upload_enabled: bool = False
    client_upload_moderation: bool = False
    show_filename: bool = False
    show_filename_lightbox: bool = False
    show_exif: bool = False
    show_iptc: bool = False
    notifications_enabled: bool = True

    header_focus_x: float = 50.0
    header_focus_y: float = 50.0
    cover_image_id: str | None = None
    cover_image_filename: str | None = None
    image_count: int = 0
    comment_count: int = 0
    cover_image_url: str | None = None
    created_at: datetime
    updated_at: datetime
    children: list[GalleryResponse] = []

    @model_validator(mode="before")
    @classmethod
    def _derive_has_password(cls, data):
        if hasattr(data, "password_hash"):
            data.__dict__["has_password"] = data.password_hash is not None
        elif isinstance(data, dict) and "has_password" not in data:
            data["has_password"] = data.get("password_hash") is not None
        return data


class SubGalleryNavItem(BaseModel):
    name: str
    share_token: str
    image_count: int
    cover_image_url: str | None = None


class GalleryCrumb(BaseModel):
    name: str
    share_token: str


class GalleryPublicResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    name: str
    description: str
    mode: str
    layout: str
    downloads_enabled: bool
    enable_team_voting: bool = False
    watermark_enabled: bool = False
    # Instance-wide setting: whether grids may upgrade to the larger renditions via srcset.
    high_res_previews: bool = True
    # Instance-wide public lightbox backdrop tone (dimmed/black/white/transparent).
    lightbox_backdrop: str = "dimmed"
    # Instance-wide default photo sort — the client gallery seeds its initial sort from this.
    default_sort: str = "captured"
    default_sort_dir: str = "asc"
    headline: str | None = None
    header_image_url: str | None = None
    expires_at: datetime | None

    # Presentation
    opener_font: str = "sans"
    opener_font_size: str = "medium"
    preview_size: str = "medium"
    preview_spacing: str = "medium"
    preview_corners: str = "round"
    bg_brightness: str = "dark"
    bg_dimmed_color: str | None = None

    # Collaboration feature toggles
    color_flags_enabled: bool = True
    likes_enabled: bool = False
    comments_enabled: bool = True
    annotations_enabled: bool = False
    sets_enabled: bool = False
    client_upload_enabled: bool = False
    # Public UI cue: when on, uploads land in the approval queue (uploader sees "awaiting review").
    client_upload_moderation: bool = False
    show_filename: bool = False
    show_filename_lightbox: bool = False
    show_exif: bool = False
    show_iptc: bool = False

    header_focus_x: float = 50.0
    header_focus_y: float = 50.0
    image_count: int = 0
    cover_image_url: str | None = None

    # Navigation: direct children and parent info for sidebar navigation
    subgalleries: list[SubGalleryNavItem] = []
    parent_name: str | None = None
    parent_share_token: str | None = None
    parent_mode: str | None = None
    parent_cover_image_url: str | None = None
    # Full ancestor chain (root first, excluding the current gallery) for deep-nesting breadcrumbs.
    ancestors: list[GalleryCrumb] = []

    # Instance branding for the public footer (global; present only when enabled).
    accent_color: str | None = None
    footer: FooterSettings | None = None
    # Studio identity shown in the client gallery header (always present).
    instance_name: str | None = None
    logo_url: str | None = None


class GalleryMetaResponse(BaseModel):
    """Minimal, side-effect-free metadata for link-unfurl previews (Open Graph).

    Served from ``GET /api/public/g/{share_token}/meta``. Deliberately NOT the full gallery
    response: it triggers no view notification / activity log, and withholds the cover image for
    password-protected galleries. ``image_url`` is absolute when ``public_base_url`` is configured,
    otherwise app-relative (the frontend resolves it via ``metadataBase``)."""

    name: str
    description: str = ""
    image_url: str | None = None
    instance_name: str | None = None
    password_protected: bool = False
