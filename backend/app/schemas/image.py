# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


ColorFlag = Literal["none", "green", "red", "yellow", "blue"]
# 0 = unrated, 1–5 = stars.
Rating = Literal[0, 1, 2, 3, 4, 5]
ProcessingStatus = Literal["pending", "done", "error"]


class ImagePicks(BaseModel):
    """Token-readable per-image client review state for one gallery (Lightroom readback).

    A narrow projection — color flag, star rating, like count — with no comments, no PII,
    and no cross-gallery enumeration. Gated by the `images:read` scope."""

    image_id: str
    filename: str
    color_flag: str
    rating: int
    like_count: int


class ImageResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    gallery_id: str
    original_filename: str
    width: int | None
    height: int | None
    file_size: int
    mime_type: str
    exif_data: dict[str, Any] | None = None
    iptc_data: dict[str, Any] | None = None
    sort_order: int
    color_flag: str
    rating: int = 0
    likes: int
    comment_count: int = 0
    annotation_count: int = 0
    uploaded_by: str | None = None
    moderation_status: str = "approved"
    processing_status: str
    is_video: bool = False
    thumb_url: str | None = None
    # Intermediate rendition (the lightbox shows it on phones/tablets via srcset; null for video).
    small_url: str | None = None
    medium_url: str | None = None
    original_url: str | None = None
    video_url: str | None = None
    video_poster_url: str | None = None
    created_at: datetime


class GlobalSearchResult(ImageResponse):
    """An image from instance-wide search/browse. Carries its gallery's name + share token so the
    overview can badge each result and deep-link straight into that gallery's lightbox."""

    gallery_name: str
    gallery_share_token: str


class PhotoPage(BaseModel):
    """One page of the cross-gallery "All Photos" browser. `total` drives the load-more affordance."""

    items: list[GlobalSearchResult]
    total: int
    offset: int
    limit: int


class ImageUpdate(BaseModel):
    sort_order: int | None = None
    color_flag: ColorFlag | None = None
    rating: Rating | None = None
    original_filename: str | None = None


class PublicFlagRequest(BaseModel):
    flag: ColorFlag


class PublicRateRequest(BaseModel):
    rating: Rating


class PublicLikeRequest(BaseModel):
    reviewer: str = Field(min_length=1, max_length=255)


class UploadResponse(BaseModel):
    id: str
    original_filename: str
    file_size: int
    mime_type: str
    processing_status: ProcessingStatus
    is_video: bool = False
    thumb_url: str | None = None
    medium_url: str | None = None


class ReorderRequest(BaseModel):
    image_ids: list[str]


class ImageTransfer(BaseModel):
    """Copy or move a set of a gallery's images into an existing target gallery."""

    image_ids: list[str] = Field(..., min_length=1)
    target_gallery_id: str
    operation: Literal["copy", "move"] = "copy"


class TransferResult(BaseModel):
    count: int
    target_gallery_id: str
