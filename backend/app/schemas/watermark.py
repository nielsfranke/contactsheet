# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

WatermarkMode = Literal["image", "text"]
WatermarkSize = Literal["small", "medium", "large"]
WatermarkPosition = Literal[
    "top-left", "top-center", "top-right",
    "center-left", "center", "center-right",
    "bottom-left", "bottom-center", "bottom-right",
]


class WatermarkSettings(BaseModel):
    """Per-gallery watermark config, persisted as JSON in `Gallery.watermark_settings`.

    A back-compatible superset of the legacy shape (`filename`/`opacity`/`size`/
    `position`): legacy rows have no `mode`/`enabled` and so default to an inactive
    image watermark until the admin enables one.
    """

    model_config = {"extra": "ignore"}

    enabled: bool = False
    mode: WatermarkMode = "image"
    opacity: int = Field(default=50, ge=0, le=100)
    size: WatermarkSize = "medium"
    position: WatermarkPosition = "bottom-right"
    # Image mode — uploaded via POST /galleries/{id}/watermark.
    filename: str | None = None
    # Text mode.
    text: str | None = Field(default=None, max_length=120)
    color: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")

    def is_active(self) -> bool:
        if not self.enabled:
            return False
        if self.mode == "text":
            return bool(self.text and self.text.strip())
        return bool(self.filename)
