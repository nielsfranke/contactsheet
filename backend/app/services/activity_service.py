# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Activity logging for public (client-facing) events: gallery opens, downloads, client uploads.

Centralizes the privacy policy: client IPs are stored on activity rows **only** while the admin
has turned IP logging on (`app_settings.activity_ip_logging`, off by default). Admin-side actions
are never routed through here, so they never carry an IP. Gallery opens ("viewed") are deduped
per IP per window so a refresh storm collapses to one entry per visitor.
"""

from datetime import datetime, timedelta, timezone

from starlette.requests import Request
from sqlalchemy.orm import Session

from app.rate_limit import client_ip
from app.repositories import activity_repo, settings_repo

# Collapse repeat opens from the same visitor into one entry within this window.
VIEW_DEDUP_MINUTES = 30


def _ip_logging_on(db: Session) -> bool:
    try:
        return bool(settings_repo.get(db).activity_ip_logging)
    except Exception:  # pragma: no cover - defensive; logging must never break the request
        return False


def resolve_ip(db: Session, request: Request | None) -> str | None:
    """The IP to store on an activity row: the real client IP when logging is on, else None."""
    if request is None or not _ip_logging_on(db):
        return None
    return client_ip(request)


def log_view(db: Session, gallery_id: str, request: Request) -> None:
    """Log a deduplicated gallery-open. Only when IP logging is on — without an IP a view row is
    neither dedupable nor informative, so opens aren't recorded until the admin opts in."""
    try:
        if not _ip_logging_on(db):
            return
        ip = client_ip(request)
        since = datetime.now(timezone.utc) - timedelta(minutes=VIEW_DEDUP_MINUTES)
        if activity_repo.recent_view_exists(db, gallery_id, ip, since):
            return
        activity_repo.log(db, gallery_id, "viewed", "Guest", ip=ip)
    except Exception:  # pragma: no cover - defensive
        pass


def log_download(db: Session, gallery_id: str, request: Request, count: int) -> None:
    """Log a download (ZIP request). Always recorded (discrete, low-volume); IP only when on."""
    try:
        activity_repo.log(
            db, gallery_id, "downloaded", "Guest",
            ip=resolve_ip(db, request), meta={"count": count},
        )
    except Exception:  # pragma: no cover - defensive
        pass
