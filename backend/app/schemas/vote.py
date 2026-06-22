# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ColorFlag = Literal["none", "green", "red", "yellow", "blue"]
# 0 = cleared/unrated, 1–5 = stars.
Rating = Literal[0, 1, 2, 3, 4, 5]


class VoteCreate(BaseModel):
    reviewer_name: str = Field(..., min_length=1, max_length=255)
    # Exactly one of these carries the per-reviewer value, depending on the instance rating_mode.
    # The unset one defaults and leaves the stored column untouched on upsert.
    color_flag: ColorFlag = "none"
    rating: Rating = 0


class VoteResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    image_id: str
    gallery_id: str
    reviewer_name: str
    color_flag: str
    rating: int = 0
    updated_at: datetime


class VoteSummaryResponse(BaseModel):
    reviewers: list[str]
    images: dict[str, dict]
