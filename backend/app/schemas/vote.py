# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ColorFlag = Literal["none", "green", "red", "yellow", "blue"]


class VoteCreate(BaseModel):
    reviewer_name: str = Field(..., min_length=1, max_length=255)
    color_flag: ColorFlag


class VoteResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    image_id: str
    gallery_id: str
    reviewer_name: str
    color_flag: str
    updated_at: datetime


class VoteSummaryResponse(BaseModel):
    reviewers: list[str]
    images: dict[str, dict]
