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


class GalleryAnalytics(BaseModel):
    gallery_id: str
    days: int
    # False when IP logging is off: views/visitors are unavailable, not zero.
    views_available: bool
    totals: EngagementTotals
    views_series: list[TimeseriesPoint]
    downloads_series: list[TimeseriesPoint]
    top_images: list[TopImage]
    recent_visitors: list[VisitorEntry]


class GalleryRollup(BaseModel):
    gallery_id: str
    name: str
    totals: EngagementTotals
    score: int


class InstanceAnalytics(BaseModel):
    days: int
    views_available: bool
    totals: EngagementTotals
    views_series: list[TimeseriesPoint]
    downloads_series: list[TimeseriesPoint]
    busiest_galleries: list[GalleryRollup]
