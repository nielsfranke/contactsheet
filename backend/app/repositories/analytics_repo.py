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

Every activity query takes a `since` (and optional `until`) window so the
dashboard's range selector applies to the whole read-model, not just the charts.
`review_status` is the one exception: it reads the *current* state of the images
(flags, stars, likes, votes, comments) rather than history.
"""

from datetime import datetime

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.models.activity import Activity
from app.models.comment import Comment
from app.models.gallery import Gallery
from app.models.image import Image
from app.models.like import ImageLike
from app.models.vote import ImageVote

# Actions that carry an image_id and represent a client engaging with a specific
# photo. Used for the "top photos" ranking and the per-image engagement total.
ENGAGEMENT_ACTIONS = ("flagged", "liked", "rated", "voted", "commented", "annotated")

# Actions attributed to a named client for the "reviewers" table — everything a
# person does under their reviewer name. Views/downloads are anonymous ("Guest").
REVIEWER_ACTIONS = ENGAGEMENT_ACTIONS + ("uploaded",)

# Authors that are not a named client: anonymous public rows ("Guest" views/downloads,
# "client" = the shared flag/rate path, which carries no reviewer name) and the photographer.
_NON_REVIEWER_AUTHORS = ("Guest", "Admin", "admin", "client")

FLAG_COLORS = ("none", "green", "red", "yellow", "blue")


def _offset_modifier(tz_offset_minutes: int) -> str:
    """SQLite datetime() modifier that shifts UTC timestamps into the viewer's local
    day before bucketing, so day boundaries match what the photographer sees."""
    # e.g. -120 -> "-120 minutes"; 0 -> "+0 minutes"
    sign = "+" if tz_offset_minutes >= 0 else "-"
    return f"{sign}{abs(tz_offset_minutes)} minutes"


def _window(stmt, since: datetime | None, until: datetime | None):
    if since is not None:
        stmt = stmt.where(Activity.created_at >= since)
    if until is not None:
        stmt = stmt.where(Activity.created_at < until)
    return stmt


def summary(
    db: Session, gallery_id: str, since: datetime | None = None, until: datetime | None = None
) -> dict[str, int]:
    """Count per action for one gallery within [since, until). Missing actions simply
    don't appear. No window → all-time."""
    stmt = _window(
        select(Activity.action, func.count()).where(Activity.gallery_id == gallery_id),
        since, until,
    ).group_by(Activity.action)
    return {action: count for action, count in db.execute(stmt).all()}


def timeseries(
    db: Session,
    gallery_id: str,
    actions: str | tuple[str, ...],
    since: datetime,
    tz_offset_minutes: int = 0,
) -> dict[str, int]:
    """Daily counts of one action (or the sum of several) for one gallery since
    `since`. Keyed by ISO date string (local to the offset). Gaps are NOT filled
    here — the service zero-fills."""
    if isinstance(actions, str):
        actions = (actions,)
    modifier = _offset_modifier(tz_offset_minutes)
    day = func.date(Activity.created_at, modifier)
    rows = db.execute(
        select(day.label("day"), func.count())
        .where(
            Activity.gallery_id == gallery_id,
            Activity.action.in_(actions),
            Activity.created_at >= since,
        )
        .group_by("day")
    ).all()
    return {d: c for d, c in rows}


def top_images(
    db: Session, gallery_id: str, since: datetime | None = None, limit: int = 12
) -> list[tuple[str, dict[str, int]]]:
    """Image IDs in this gallery ranked by total engagement since `since`, each with
    a per-action breakdown. Soft-deleted images are excluded via the join. Returns
    [(image_id, {action: count, ...}), ...] ordered by total desc."""
    stmt = (
        select(Activity.image_id, Activity.action, func.count())
        .join(Image, Image.id == Activity.image_id)
        .where(
            Activity.gallery_id == gallery_id,
            Activity.image_id.isnot(None),
            Activity.action.in_(ENGAGEMENT_ACTIONS),
            Image.deleted_at.is_(None),
        )
    )
    rows = db.execute(_window(stmt, since, None).group_by(Activity.image_id, Activity.action)).all()

    breakdowns: dict[str, dict[str, int]] = {}
    for image_id, action, count in rows:
        breakdowns.setdefault(image_id, {})[action] = count

    ranked = sorted(breakdowns.items(), key=lambda kv: sum(kv[1].values()), reverse=True)
    return ranked[:limit]


def _rank_reviewers(rows) -> list[tuple[str, dict[str, int], datetime]]:
    breakdowns: dict[str, dict[str, int]] = {}
    last: dict[str, datetime] = {}
    for author, action, count, latest in rows:
        breakdowns.setdefault(author, {})[action] = count
        if author not in last or latest > last[author]:
            last[author] = latest
    ranked = sorted(breakdowns.items(), key=lambda kv: sum(kv[1].values()), reverse=True)
    return [(name, bd, last[name]) for name, bd in ranked]


def top_reviewers(
    db: Session, gallery_id: str, since: datetime | None = None, limit: int = 10
) -> list[tuple[str, dict[str, int], datetime]]:
    """Named clients ranked by what they did in this gallery since `since`.
    Returns [(name, {action: count}, last_active), ...] ordered by total desc."""
    stmt = select(Activity.author, Activity.action, func.count(), func.max(Activity.created_at)).where(
        Activity.gallery_id == gallery_id,
        Activity.action.in_(REVIEWER_ACTIONS),
        Activity.author.notin_(_NON_REVIEWER_AUTHORS),
    )
    rows = db.execute(_window(stmt, since, None).group_by(Activity.author, Activity.action)).all()
    return _rank_reviewers(rows)[:limit]


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


# ---- current review state (not activity history) --------------------------------


def review_status(db: Session, gallery_id: str) -> dict:
    """Snapshot of the gallery's live images: shared flag distribution, shared star
    histogram, how many carry likes/comments, distinct team voters, and how many
    photos carry *any* mark at all. Reads the images/votes/likes/comments tables
    directly — the activity log is not a reliable source for current state (a
    flag set then cleared logs two rows but ends at "none")."""
    live = (Image.gallery_id == gallery_id, Image.deleted_at.is_(None))

    total = db.execute(select(func.count()).select_from(Image).where(*live)).scalar_one()

    flags = {c: 0 for c in FLAG_COLORS}
    for flag, count in db.execute(
        select(Image.color_flag, func.count()).where(*live).group_by(Image.color_flag)
    ).all():
        flags[flag if flag in flags else "none"] += count

    ratings = [0] * 6
    for rating, count in db.execute(
        select(Image.rating, func.count()).where(*live).group_by(Image.rating)
    ).all():
        ratings[min(max(int(rating or 0), 0), 5)] += count

    liked = db.execute(
        select(func.count()).select_from(Image).where(*live, Image.likes > 0)
    ).scalar_one()

    has_comment = exists().where(Comment.image_id == Image.id)
    has_vote = exists().where(
        ImageVote.image_id == Image.id,
        or_(ImageVote.color_flag != "none", ImageVote.rating > 0),
    )
    has_like = exists().where(ImageLike.image_id == Image.id)

    commented = db.execute(
        select(func.count()).select_from(Image).where(*live, has_comment)
    ).scalar_one()

    reviewed = db.execute(
        select(func.count()).select_from(Image).where(
            *live,
            or_(Image.color_flag != "none", Image.rating > 0, Image.likes > 0, has_like, has_vote, has_comment),
        )
    ).scalar_one()

    voters = db.execute(
        select(func.count(func.distinct(ImageVote.reviewer_name)))
        .join(Image, Image.id == ImageVote.image_id)
        .where(*live, or_(ImageVote.color_flag != "none", ImageVote.rating > 0))
    ).scalar_one()

    return {
        "images": total,
        "reviewed": reviewed,
        "flags": flags,
        "ratings": ratings,
        "liked": liked,
        "commented": commented,
        "voters": voters,
    }


# ---- instance-wide rollup ----------------------------------------------------


def _live_galleries(stmt):
    return stmt.join(Gallery, Gallery.id == Activity.gallery_id).where(Gallery.deleted_at.is_(None))


def instance_summary(
    db: Session, since: datetime | None = None, until: datetime | None = None
) -> dict[str, int]:
    """Count per action across all non-deleted galleries within [since, until)."""
    stmt = _window(_live_galleries(select(Activity.action, func.count())), since, until).group_by(Activity.action)
    return {action: count for action, count in db.execute(stmt).all()}


def instance_timeseries(
    db: Session, actions: str | tuple[str, ...], since: datetime, tz_offset_minutes: int = 0
) -> dict[str, int]:
    """Daily counts of one action (or the sum of several) across all non-deleted
    galleries since `since`."""
    if isinstance(actions, str):
        actions = (actions,)
    modifier = _offset_modifier(tz_offset_minutes)
    day = func.date(Activity.created_at, modifier)
    rows = db.execute(
        _live_galleries(select(day.label("day"), func.count()))
        .where(Activity.action.in_(actions), Activity.created_at >= since)
        .group_by("day")
    ).all()
    return {d: c for d, c in rows}


def busiest_galleries(
    db: Session, since: datetime | None = None, limit: int = 10
) -> list[tuple[str, dict[str, int]]]:
    """Non-deleted galleries ranked by total activity since `since`, each with a
    per-action breakdown. Returns [(gallery_id, {action: count, ...}), ...] ordered
    by total desc."""
    stmt = _window(_live_galleries(select(Activity.gallery_id, Activity.action, func.count())), since, None)
    rows = db.execute(stmt.group_by(Activity.gallery_id, Activity.action)).all()

    breakdowns: dict[str, dict[str, int]] = {}
    for gallery_id, action, count in rows:
        breakdowns.setdefault(gallery_id, {})[action] = count

    ranked = sorted(breakdowns.items(), key=lambda kv: sum(kv[1].values()), reverse=True)
    return ranked[:limit]


def instance_top_reviewers(
    db: Session, since: datetime | None = None, limit: int = 10
) -> list[tuple[str, dict[str, int], datetime]]:
    """Named clients ranked across all non-deleted galleries since `since`."""
    stmt = _live_galleries(
        select(Activity.author, Activity.action, func.count(), func.max(Activity.created_at))
    ).where(
        Activity.action.in_(REVIEWER_ACTIONS),
        Activity.author.notin_(_NON_REVIEWER_AUTHORS),
    )
    rows = db.execute(_window(stmt, since, None).group_by(Activity.author, Activity.action)).all()
    return _rank_reviewers(rows)[:limit]
