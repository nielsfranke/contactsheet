# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AnchorPoint(BaseModel):
    """A single normalized point on the image (fractions 0..1)."""

    model_config = {"extra": "forbid"}

    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)


# Cap a freehand stroke so a client can't store an unbounded path.
MAX_FREEHAND_POINTS = 1000


class Anchor(BaseModel):
    """Spatial anchor on an image → turns a comment into an annotation.

    Coordinates are fractions (0..1) of the image's intrinsic content box, so a mark maps onto any
    rendition (thumb/medium/original) and any display size. A ``freehand`` mark carries a ``points``
    path; ``pin``/``rect`` (legacy vector marks) carry ``x/y`` (+ ``w/h`` for rect).
    """

    model_config = {"extra": "forbid"}

    type: Literal["pin", "rect", "freehand"]
    x: float | None = Field(None, ge=0, le=1)
    y: float | None = Field(None, ge=0, le=1)
    w: float | None = Field(None, gt=0, le=1)
    h: float | None = Field(None, gt=0, le=1)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    width: float | None = Field(None, ge=1, le=24)  # freehand stroke width in px
    points: list[AnchorPoint] | None = None

    @model_validator(mode="after")
    def _check_shape(self) -> "Anchor":
        if self.type == "freehand":
            if not self.points or len(self.points) < 2:
                raise ValueError("freehand anchors require at least 2 points")
            if len(self.points) > MAX_FREEHAND_POINTS:
                raise ValueError(f"freehand anchors are limited to {MAX_FREEHAND_POINTS} points")
            if self.x is not None or self.y is not None or self.w is not None or self.h is not None:
                raise ValueError("freehand anchors must not carry x/y/w/h")
        elif self.type == "pin":
            if self.x is None or self.y is None:
                raise ValueError("pin anchors require x and y")
            if self.w is not None or self.h is not None or self.points is not None:
                raise ValueError("pin anchors must not carry w/h/points")
        else:  # rect
            if self.x is None or self.y is None or self.w is None or self.h is None:
                raise ValueError("rect anchors require x, y, w and h")
            if self.points is not None:
                raise ValueError("rect anchors must not carry points")
            if self.x + self.w > 1 or self.y + self.h > 1:
                raise ValueError("rect anchor must stay within the image")
        return self


class CommentCreate(BaseModel):
    author_name: str = Field(..., min_length=1, max_length=255)
    text: str = Field(..., min_length=1, max_length=2000)
    anchor: Anchor | None = None


class CommentUpdate(BaseModel):
    """Edit a comment/annotation. Text only — author and the spatial anchor are immutable here."""

    text: str = Field(..., min_length=1, max_length=2000)


class CommentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    image_id: str
    author_name: str
    text: str
    anchor: Anchor | None = None
    created_at: datetime
