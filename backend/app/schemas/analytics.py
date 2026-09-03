# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.image import ImageResponse


class TimeseriesPoint(BaseModel):
    date: str  # ISO date, local to the requested tz offset
    count: int


class EngagementTotals(BaseModel):
    """Per-action totals. Keys mirror activity actions; absent actions are 0."""

    views: int = 0
    downloads: int = 0
    uploads: int = 0
    flags: int = 0
    likes: int = 0
    ratings: int = 0
    votes: int = 0
    comments: int = 0
    annotations: int = 0


class TopImage(BaseModel):
    image: ImageResponse
    score: int  # total engagement count
    breakdown: dict[str, int]  # action -> count


class VisitorEntry(BaseModel):
    ip: str | None
    at: datetime


class ReviewerEntry(BaseModel):
    """A named client (reviewer / uploader) and what they did in the window."""

    name: str
    score: int  # total engagement count
    breakdown: dict[str, int]  # action -> count
    last_active: datetime


class ReviewStatus(BaseModel):
    """Where the selection stands *right now* — current state of the gallery's live images,
    not activity history. Unaffected by the `days` window."""

    images: int  # live (non-deleted) images
    reviewed: int  # images carrying any mark: flag, star, like, team vote or comment
    flags: dict[str, int]  # shared color flag -> image count (all five colours present)
    ratings: list[int]  # index = shared star rating 0..5 -> image count (0 = unrated)
    liked: int  # images with at least one like
    commented: int  # images with at least one comment/annotation
    voters: int  # distinct reviewers who cast a team vote


class GalleryAnalytics(BaseModel):
    gallery_id: str
    days: int
    # False when IP logging is off: views/visitors are unavailable, not zero.
    views_available: bool
    # Windowed to the last `days`; previous_totals covers the `days` before that (for deltas).
    totals: EngagementTotals
    previous_totals: EngagementTotals
    views_series: list[TimeseriesPoint]
    downloads_series: list[TimeseriesPoint]
    engagement_series: list[TimeseriesPoint]
    top_images: list[TopImage]
    top_reviewers: list[ReviewerEntry]
    review_status: ReviewStatus
    recent_visitors: list[VisitorEntry]


class GalleryRollup(BaseModel):
    gallery_id: str
    name: str
    totals: EngagementTotals
    score: int  # all activity in the window (incl. views/downloads/uploads)
    engagement: int  # per-photo engagement only (flags/likes/ratings/votes/comments/annotations)


class InstanceAnalytics(BaseModel):
    days: int
    views_available: bool
    totals: EngagementTotals
    previous_totals: EngagementTotals
    views_series: list[TimeseriesPoint]
    downloads_series: list[TimeseriesPoint]
    engagement_series: list[TimeseriesPoint]
    busiest_galleries: list[GalleryRollup]
    top_reviewers: list[ReviewerEntry]
