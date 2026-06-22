# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.gallery import (
    BrightnessType,
    CornersType,
    FontType,
    FooterSettings,
    LayoutType,
    SizeType,
    TitlePositionType,
)
from app.schemas.notifications import NotificationSettings


class GalleryPreset(BaseModel):
    """Default look & behaviour for newly created galleries (one preset per mode).

    Every field is optional — absent means "use the model's built-in default".
    Covers the cascade field set minus identity, expiry, and the per-gallery-only
    operational toggles (client upload, moderation, notifications).
    """

    model_config = {"extra": "forbid"}

    # Presentation
    layout: LayoutType | None = None
    opener_font: FontType | None = None
    opener_font_size: SizeType | None = None
    opener_title_position: TitlePositionType | None = None
    preview_size: SizeType | None = None
    preview_spacing: SizeType | None = None
    preview_corners: CornersType | None = None
    bg_brightness: BrightnessType | None = None
    bg_dimmed_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{3,8}$")
    # Behaviour
    downloads_enabled: bool | None = None
    enable_team_voting: bool | None = None
    color_flags_enabled: bool | None = None
    likes_enabled: bool | None = None
    comments_enabled: bool | None = None
    annotations_enabled: bool | None = None
    sets_enabled: bool | None = None
    show_filename: bool | None = None
    show_filename_lightbox: bool | None = None
    show_exif: bool | None = None
    show_iptc: bool | None = None


class AdminGridView(BaseModel):
    """Override look for the admin photo grid (admin-only; never affects the public gallery).

    Every field is optional — absent means "use the built-in default".
    """

    model_config = {"extra": "forbid"}

    layout: LayoutType | None = None
    preview_size: SizeType | None = None
    preview_spacing: SizeType | None = None
    preview_corners: CornersType | None = None


class SemanticSearchSettings(BaseModel):
    """Semantic content-search config. Off by default; the ML sidecar and indexing only run once
    an admin enables it. `model` selects the encoder (pluggable — swapping re-indexes the library).
    `default_threshold` seeds the search UI's accuracy slider (cosine cutoff, 0..1)."""

    model_config = {"extra": "forbid"}

    enabled: bool = False
    model: str = Field(default="siglip2-base-multilingual", min_length=1, max_length=64)
    # SigLIP cosines sit in a low, offset range: every text has a ~0.06–0.07 baseline similarity
    # with any image (so a *too*-low cutoff matches even gibberish), while a real topical match
    # rises to ~0.09–0.12. The default sits in that gap. Raising it tightens precision; lowering
    # favours recall. The slider operates in the meaningful 0–30% band.
    default_threshold: float = Field(default=0.08, ge=0.0, le=1.0)
    # Encode the original file (vs. the medium rendition). Originals give the model the most to
    # work with; the sidecar downsamples internally so the cost is the same either way.
    index_originals: bool = True


class AppSettingsUpdate(BaseModel):
    instance_name: str | None = Field(default=None, min_length=1, max_length=255)
    accent_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{3,8}$")
    accent_gradient: bool | None = None
    admin_theme: Literal["light", "dark"] | None = None
    # Admin UI language. Keep in sync with the frontend SUPPORTED_LOCALES (src/i18n/request.ts).
    admin_locale: Literal["en", "de"] | None = None
    lightbox_backdrop: Literal["dimmed", "black", "white", "transparent"] | None = None
    # Masthead branding. brand_color/tagline: "" clears, value sets, None = no change.
    brand_display: Literal["logo_name", "logo_only", "name_only"] | None = None
    brand_font: FontType | None = None
    brand_color: str | None = Field(default=None, max_length=20)
    tagline: str | None = Field(default=None, max_length=120)
    # "" clears it; an http(s) origin sets it; None = no change.
    public_base_url: str | None = Field(default=None, max_length=255)
    # Source-code URL (AGPL §13). "" clears back to the upstream default; an http(s) URL sets it.
    source_url: str | None = Field(default=None, max_length=255)
    high_res_previews: bool | None = None
    # Instance-wide rating style: color flags vs. 1–5 stars (never both).
    rating_mode: Literal["flags", "stars"] | None = None
    # An object replaces the preset; explicit null clears it back to built-in defaults;
    # omitted = no change (distinguished via model_fields_set in the router).
    preset_presentation: GalleryPreset | None = None
    preset_collaboration: GalleryPreset | None = None
    # Admin-only view preferences.
    admin_grid_mode: Literal["mirror", "custom"] | None = None
    # Object replaces the override; explicit null resets to built-in defaults (model_fields_set).
    admin_grid_view: AdminGridView | None = None
    overview_size: SizeType | None = None
    overview_shape: Literal["square", "aspect"] | None = None
    overview_spacing: SizeType | None = None
    overview_corners: Literal["round", "square"] | None = None
    overview_sort: Literal["created", "name", "photos"] | None = None
    overview_sort_dir: Literal["asc", "desc"] | None = None
    gallery_sort: Literal["manual", "filename", "date", "captured"] | None = None
    gallery_sort_dir: Literal["asc", "desc"] | None = None
    # Public branding footer.
    footer_enabled: bool | None = None
    # Object replaces the footer; explicit null clears it (model_fields_set).
    footer: FooterSettings | None = None
    # Object replaces (merged over stored to preserve masked URLs); explicit null clears it.
    notifications: NotificationSettings | None = None
    # Object replaces the whole semantic-search config; explicit null clears it.
    semantic_search: SemanticSearchSettings | None = None
    # Activity-log IP capture (privacy-sensitive).
    activity_ip_logging: bool | None = None
    activity_ip_retention_days: int | None = Field(default=None, ge=1, le=3650)

    @field_validator("brand_color")
    @classmethod
    def _validate_brand_color(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return ""
        if not re.fullmatch(r"#[0-9a-fA-F]{3,8}", v):
            raise ValueError("Color must be a hex value like #1a2b3c")
        return v

    @field_validator("public_base_url", "source_url")
    @classmethod
    def _validate_base_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().rstrip("/")
        if v == "":
            return ""
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("Base URL must start with http:// or https://")
        return v


class AppSettingsResponse(BaseModel):
    model_config = {"from_attributes": True}

    version: str = ""
    instance_name: str
    accent_color: str
    accent_gradient: bool = False
    logo_filename: str | None
    logo_url: str | None = None
    admin_theme: str
    admin_locale: str = "en"
    lightbox_backdrop: str = "dimmed"
    brand_display: str = "logo_name"
    brand_font: str = "sans"
    brand_color: str | None = None
    tagline: str | None = None
    public_base_url: str | None = None
    source_url: str | None = None
    high_res_previews: bool = True
    rating_mode: str = "flags"
    preset_presentation: GalleryPreset | None = None
    preset_collaboration: GalleryPreset | None = None
    admin_grid_mode: str = "mirror"
    admin_grid_view: AdminGridView | None = None
    overview_size: str = "medium"
    overview_shape: str = "square"
    overview_spacing: str = "medium"
    overview_corners: str = "round"
    overview_sort: str = "created"
    overview_sort_dir: str = "desc"
    gallery_sort: str = "captured"
    gallery_sort_dir: str = "asc"
    footer_enabled: bool = False
    footer: FooterSettings | None = None
    # Masked (channel URLs hidden, has_url flag added) — see schemas.notifications.mask_settings.
    notifications: dict | None = None
    semantic_search: SemanticSearchSettings | None = None
    activity_ip_logging: bool = False
    activity_ip_retention_days: int = 90


class ResetRequest(BaseModel):
    password: str
