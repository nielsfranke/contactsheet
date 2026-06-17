# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    image_ids: list[str] = Field(default_factory=list)
    # Public side only: reviewer name of the creator. Ignored for admin-created collections.
    creator: str | None = Field(default=None, max_length=100)


class CollectionUpdate(BaseModel):
    """Edit a collection after creation. `name` and/or `image_ids` (a full ordered replacement of
    the membership) — at least one must be present. `actor` is the public reviewer name used for the
    creator-match authorization; ignored for admin."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    image_ids: list[str] | None = None
    actor: str | None = Field(default=None, max_length=100)


class CollectionResponse(BaseModel):
    id: str
    gallery_id: str
    name: str
    created_by: str | None = None
    image_ids: list[str] = []
    image_count: int = 0
    cover_url: str | None = None
    created_at: datetime
