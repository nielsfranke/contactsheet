# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


class ApiToken(Base):
    """A personal access token for third-party API clients (Capture One / Lightroom export
    plugins, scripts, CI). Authenticates as the admin but is limited to its granted `scopes`;
    it can never reach settings, factory reset, auth/password or token management — those stay
    cookie-admin only (see `auth/dependencies.require_scope`).

    Only the SHA-256 hash of the secret is stored. The plaintext (`cs_pat_…`) is shown **once**
    at creation and never recoverable; `prefix` keeps the first chars so a token is identifiable
    in the UI without revealing it. Revocation is a hard delete of the row."""

    __tablename__ = "api_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    prefix: Mapped[str] = mapped_column(String(20), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False, default=_now)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
