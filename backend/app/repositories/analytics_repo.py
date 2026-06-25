# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Read-only aggregation queries over the `activities` table for the analytics
dashboard. No writes. All queries are scoped (by gallery, or instance-wide over
non-deleted galleries) and lean on the `(gallery_id, created_at)` index.

The numbers here are *derived* — the source of truth stays `activities`. Two
data facts shape what's possible (see docs/architecture/photographer-analytics.md):
`viewed` rows exist only while IP logging is on, and `downloaded` is a
gallery-level ZIP event (no per-image download record), so "top photos" ranks by
per-image engagement instead.
"""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity import Activity
from app.models.gallery import Gallery

# Actions that carry an image_id and represent a client engaging with a specific
# photo. Used for the "top photos" ranking and the per-image engagement total.
ENGAGEMENT_ACTIONS = ("flagged", "liked", "rated", "voted", "commented", "annotated")


def _offset_modifier(tz_offset_minutes: int) -> str:
    """SQLite datetime() modifier that shifts UTC timestamps into the viewer's local
    day before bucketing, so day boundaries match what the photographer sees."""
    # e.g. -120 -> "-120 minutes"; 0 -> "+0 minutes"
    sign = "+" if tz_offset_minutes >= 0 else "-"
    return f"{sign}{abs(tz_offset_minutes)} minutes"


def summary(db: Session, gallery_id: str) -> dict[str, int]:
    """Total count per action for one gallery. Missing actions simply don't appear."""
    rows = db.execute(
        select(Activity.action, func.count())
        .where(Activity.gallery_id == gallery_id)
        .group_by(Activity.action)
    ).all()
    return {action: count for action, count in rows}


def timeseries(
    db: Session,
    gallery_id: str,
    action: str,
    since: datetime,
    tz_offset_minutes: int = 0,
) -> dict[str, int]:
    """Daily counts of one action for one gallery since `since`. Keyed by ISO date
    string (local to the offset). Gaps are NOT filled here — the service zero-fills."""
    modifier = _offset_modifier(tz_offset_minutes)
    day = func.date(Activity.created_at, modifier)
    rows = db.execute(
        select(day.label("day"), func.count())
        .where(
            Activity.gallery_id == gallery_id,
            Activity.action == action,
            Activity.created_at >= since,
        )
        .group_by("day")
    ).all()
    return {d: c for d, c in rows}


def top_images(
    db: Session, gallery_id: str, limit: int = 12
) -> list[tuple[str, dict[str, int]]]:
    """Image IDs in this gallery ranked by total engagement, each with a per-action
    breakdown. Soft-deleted images are excluded via the join. Returns
    [(image_id, {action: count, ...}), ...] ordered by total desc."""
    from app.models.image import Image

    rows = db.execute(
        select(Activity.image_id, Activity.action, func.count())
        .join(Image, Image.id == Activity.image_id)
        .where(
            Activity.gallery_id == gallery_id,
            Activity.image_id.isnot(None),
            Activity.action.in_(ENGAGEMENT_ACTIONS),
            Image.deleted_at.is_(None),
        )
        .group_by(Activity.image_id, Activity.action)
    ).all()

    breakdowns: dict[str, dict[str, int]] = {}
    for image_id, action, count in rows:
        breakdowns.setdefault(image_id, {})[action] = count

    ranked = sorted(breakdowns.items(), key=lambda kv: sum(kv[1].values()), reverse=True)
    return ranked[:limit]


def recent_visitors(db: Session, gallery_id: str, limit: int = 20) -> list[Activity]:
    """Most recent `viewed` rows for a gallery (carry IP + time when IP logging is on)."""
    return list(
        db.execute(
            select(Activity)
            .where(Activity.gallery_id == gallery_id, Activity.action == "viewed")
            .order_by(Activity.created_at.desc())
            .limit(limit)
        ).scalars().all()
    )


# ---- instance-wide rollup ----------------------------------------------------


def instance_summary(db: Session) -> dict[str, int]:
    """Total count per action across all non-deleted galleries."""
    rows = db.execute(
        select(Activity.action, func.count())
        .join(Gallery, Gallery.id == Activity.gallery_id)
        .where(Gallery.deleted_at.is_(None))
        .group_by(Activity.action)
    ).all()
    return {action: count for action, count in rows}


def instance_timeseries(
    db: Session, action: str, since: datetime, tz_offset_minutes: int = 0
) -> dict[str, int]:
    """Daily counts of one action across all non-deleted galleries since `since`."""
    modifier = _offset_modifier(tz_offset_minutes)
    day = func.date(Activity.created_at, modifier)
    rows = db.execute(
        select(day.label("day"), func.count())
        .join(Gallery, Gallery.id == Activity.gallery_id)
        .where(
            Gallery.deleted_at.is_(None),
            Activity.action == action,
            Activity.created_at >= since,
        )
        .group_by("day")
    ).all()
    return {d: c for d, c in rows}


def busiest_galleries(
    db: Session, limit: int = 10
) -> list[tuple[str, dict[str, int]]]:
    """Non-deleted galleries ranked by total activity, each with a per-action breakdown.
    Returns [(gallery_id, {action: count, ...}), ...] ordered by total desc."""
    rows = db.execute(
        select(Activity.gallery_id, Activity.action, func.count())
        .join(Gallery, Gallery.id == Activity.gallery_id)
        .where(Gallery.deleted_at.is_(None))
        .group_by(Activity.gallery_id, Activity.action)
    ).all()

    breakdowns: dict[str, dict[str, int]] = {}
    for gallery_id, action, count in rows:
        breakdowns.setdefault(gallery_id, {})[action] = count

    ranked = sorted(breakdowns.items(), key=lambda kv: sum(kv[1].values()), reverse=True)
    return ranked[:limit]
