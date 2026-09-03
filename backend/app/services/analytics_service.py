# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Assembles the analytics read-model returned to admins. Calls analytics_repo for
aggregates, zero-fills timeseries, hydrates top photos through the normal image
serializer (so soft-delete/moderation/watermark rules apply), and flags whether
view data is available (it exists only while IP logging is on).

The `days` window applies to everything activity-derived: totals (plus the
matching previous window for deltas), the three timeseries, top photos, top
reviewers and busiest galleries. `review_status` is a snapshot of the current
image state and ignores the window."""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.repositories import (
    analytics_repo,
    gallery_repo,
    image_repo,
    settings_repo,
)
from app.schemas.analytics import (
    EngagementTotals,
    GalleryAnalytics,
    GalleryRollup,
    InstanceAnalytics,
    ReviewerEntry,
    ReviewStatus,
    TimeseriesPoint,
    TopImage,
    VisitorEntry,
)
from app.services import image_service
from app.storage.base import StorageProvider

# Maps activity action -> EngagementTotals field.
_ACTION_TO_FIELD = {
    "viewed": "views",
    "downloaded": "downloads",
    "uploaded": "uploads",
    "flagged": "flags",
    "liked": "likes",
    "rated": "ratings",
    "voted": "votes",
    "commented": "comments",
    "annotated": "annotations",
}


def _totals(summary: dict[str, int]) -> EngagementTotals:
    fields = {field: summary.get(action, 0) for action, field in _ACTION_TO_FIELD.items()}
    return EngagementTotals(**fields)


def _engagement(summary: dict[str, int]) -> int:
    return sum(summary.get(a, 0) for a in analytics_repo.ENGAGEMENT_ACTIONS)


def _zero_fill(counts: dict[str, int], since: datetime, days: int, tz_offset_minutes: int) -> list[TimeseriesPoint]:
    """Emit one point per day from `since` to today (local), filling absent days with 0."""
    local_today = (datetime.now(timezone.utc) + timedelta(minutes=tz_offset_minutes)).date()
    start = (since + timedelta(minutes=tz_offset_minutes)).date()
    points: list[TimeseriesPoint] = []
    cur = start
    while cur <= local_today:
        key = cur.isoformat()
        points.append(TimeseriesPoint(date=key, count=counts.get(key, 0)))
        cur += timedelta(days=1)
    return points


def _views_available(db: Session) -> bool:
    try:
        return bool(settings_repo.get(db).activity_ip_logging)
    except Exception:  # pragma: no cover - defensive
        return False


def _reviewers(ranked: list[tuple[str, dict[str, int], datetime]]) -> list[ReviewerEntry]:
    return [
        ReviewerEntry(name=name, score=sum(bd.values()), breakdown=bd, last_active=last)
        for name, bd, last in ranked
    ]


def _windows(days: int) -> tuple[datetime, datetime]:
    """(since, previous_since): the current window starts at `since`; the previous,
    equally long window spans [previous_since, since)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return since, since - timedelta(days=days)


def gallery_analytics(
    db: Session,
    storage: StorageProvider,
    gallery_id: str,
    days: int = 30,
    tz_offset_minutes: int = 0,
) -> GalleryAnalytics:
    since, prev_since = _windows(days)
    views_available = _views_available(db)

    totals = _totals(analytics_repo.summary(db, gallery_id, since))
    previous_totals = _totals(analytics_repo.summary(db, gallery_id, prev_since, since))

    def series(actions):
        return _zero_fill(
            analytics_repo.timeseries(db, gallery_id, actions, since, tz_offset_minutes),
            since, days, tz_offset_minutes,
        )

    views_series = series("viewed")
    downloads_series = series("downloaded")
    engagement_series = series(analytics_repo.ENGAGEMENT_ACTIONS)

    # Hydrate top photos through the normal serializer; preserve rank order.
    ranked = analytics_repo.top_images(db, gallery_id, since, limit=12)
    image_map = image_repo.get_many(db, [iid for iid, _ in ranked])
    top: list[TopImage] = []
    for image_id, breakdown in ranked:
        img = image_map.get(image_id)
        if img is None:  # soft-deleted between query and hydrate
            continue
        top.append(
            TopImage(
                image=image_service._image_to_response(img, storage, include_original_url=False),
                score=sum(breakdown.values()),
                breakdown=breakdown,
            )
        )

    reviewers = _reviewers(analytics_repo.top_reviewers(db, gallery_id, since, limit=10))
    status = ReviewStatus(**analytics_repo.review_status(db, gallery_id))

    visitors = [
        VisitorEntry(ip=a.ip, at=a.created_at)
        for a in analytics_repo.recent_visitors(db, gallery_id, limit=20)
    ] if views_available else []

    return GalleryAnalytics(
        gallery_id=gallery_id,
        days=days,
        views_available=views_available,
        totals=totals,
        previous_totals=previous_totals,
        views_series=views_series,
        downloads_series=downloads_series,
        engagement_series=engagement_series,
        top_images=top,
        top_reviewers=reviewers,
        review_status=status,
        recent_visitors=visitors,
    )


def instance_analytics(db: Session, days: int = 30, tz_offset_minutes: int = 0) -> InstanceAnalytics:
    since, prev_since = _windows(days)
    views_available = _views_available(db)

    totals = _totals(analytics_repo.instance_summary(db, since))
    previous_totals = _totals(analytics_repo.instance_summary(db, prev_since, since))

    def series(actions):
        return _zero_fill(
            analytics_repo.instance_timeseries(db, actions, since, tz_offset_minutes),
            since, days, tz_offset_minutes,
        )

    views_series = series("viewed")
    downloads_series = series("downloaded")
    engagement_series = series(analytics_repo.ENGAGEMENT_ACTIONS)

    ranked = analytics_repo.busiest_galleries(db, since, limit=10)
    gallery_map = gallery_repo.get_by_ids(db, [gid for gid, _ in ranked])
    busiest: list[GalleryRollup] = []
    for gallery_id, breakdown in ranked:
        gallery = gallery_map.get(gallery_id)
        if gallery is None:
            continue
        busiest.append(
            GalleryRollup(
                gallery_id=gallery_id,
                name=gallery.name,
                totals=_totals(breakdown),
                score=sum(breakdown.values()),
                engagement=_engagement(breakdown),
            )
        )

    reviewers = _reviewers(analytics_repo.instance_top_reviewers(db, since, limit=10))

    return InstanceAnalytics(
        days=days,
        views_available=views_available,
        totals=totals,
        previous_totals=previous_totals,
        views_series=views_series,
        downloads_series=downloads_series,
        engagement_series=engagement_series,
        busiest_galleries=busiest,
        top_reviewers=reviewers,
    )
