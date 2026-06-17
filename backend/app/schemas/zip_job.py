# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

FilterType = Literal["all", "flagged", "green", "red", "yellow", "blue"]


class ZipJobCreate(BaseModel):
    filter_type: FilterType = "all"
    # Optional: include these direct sub-galleries (each in its own folder).
    subgallery_ids: list[str] = []
    # Optional: download only this selection of images (flat archive). Takes precedence.
    image_ids: list[str] = []


class PublicZipCreate(BaseModel):
    # Share tokens of the direct sub-galleries to include alongside the gallery's own images.
    subgallery_share_tokens: list[str] = []
    # When set, download only these images (a filtered selection) as a flat archive;
    # sub-galleries are ignored.
    image_ids: list[str] = []


class ZipJobResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    gallery_id: str
    status: str
    filter_type: str
    image_count: int | None
    error_message: str | None
    created_at: datetime
    ready_at: datetime | None
    download_url: str | None = None
