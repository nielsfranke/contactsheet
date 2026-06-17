# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str
    # "Remember me": persistent 30-day session vs a session-only cookie that clears on browser close.
    remember: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)  # mirrors the setup wizard's minimum


class ChangeUsernameRequest(BaseModel):
    new_username: str = Field(min_length=1, max_length=64)  # mirrors the setup wizard
    current_password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class GalleryAuthRequest(BaseModel):
    password: str


class GalleryAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
