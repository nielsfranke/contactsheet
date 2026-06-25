# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class BackupRequest(BaseModel):
    # "full" = DB + uploads + branding + watermarks; "metadata" = DB + branding +
    # watermarks (no originals). See docs/architecture/backup-restore.md.
    scope: Literal["full", "metadata"] = "full"
    # Only meaningful for full scope: drop regenerable thumb/medium/*-wm renditions.
    include_renditions: bool = True


class BackupJobResponse(BaseModel):
    id: str
    status: str
    scope: str
    include_renditions: bool
    size_bytes: int | None = None
    error_message: str | None = None
    created_at: datetime
    ready_at: datetime | None = None
    download_url: str | None = None


class RestoreRequest(BaseModel):
    # Re-entered current admin password — verified before anything is overwritten.
    password: str
