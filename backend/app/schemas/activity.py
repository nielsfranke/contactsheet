# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, model_validator


class ActivityResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    gallery_id: str
    image_id: str | None
    action: str
    author: str
    meta: dict[str, Any] | None = None
    ip: str | None = None
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def parse_meta(cls, data: Any) -> Any:
        if hasattr(data, "__dict__"):
            raw = data.__dict__.get("meta")
            if isinstance(raw, str):
                data.__dict__["meta"] = json.loads(raw)
        return data


class ActivityPage(BaseModel):
    items: list[ActivityResponse]
    total: int
    page: int
    limit: int
