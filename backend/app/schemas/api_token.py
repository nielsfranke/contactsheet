# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime

from pydantic import BaseModel, Field


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[str] = Field(min_length=1)
    expires_at: datetime | None = None


class ApiTokenResponse(BaseModel):
    """A token as shown in the admin list — never includes the secret."""

    id: str
    name: str
    prefix: str
    scopes: list[str]
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None

    model_config = {"from_attributes": True}


class ApiTokenCreated(ApiTokenResponse):
    """Returned only from the create call: carries the plaintext secret, shown once."""

    token: str
