# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func, update as sa_update
from sqlalchemy.orm import Session

from app.models.activity import Activity


def log(
    db: Session,
    gallery_id: str,
    action: str,
    author: str,
    image_id: str | None = None,
    meta: dict | None = None,
    ip: str | None = None,
) -> Activity:
    activity = Activity(
        id=str(uuid.uuid4()),
        gallery_id=gallery_id,
        image_id=image_id,
        action=action,
        author=author,
        meta=json.dumps(meta) if meta else None,
        ip=ip,
        created_at=datetime.now(timezone.utc),
    )
    db.add(activity)
    db.commit()
    return activity


def recent_view_exists(db: Session, gallery_id: str, ip: str, since: datetime) -> bool:
    """True if a 'viewed' row from this IP already exists since `since` — used to dedup gallery
    opens so a reload/refresh storm collapses to one entry per visitor per window."""
    n = db.execute(
        select(func.count()).where(
            Activity.gallery_id == gallery_id,
            Activity.action == "viewed",
            Activity.ip == ip,
            Activity.created_at >= since,
        )
    ).scalar_one()
    return n > 0


def scrub_ips_before(db: Session, cutoff: datetime) -> int:
    """Null out stored IPs on activity rows older than `cutoff` (retention). Returns row count."""
    res = db.execute(
        sa_update(Activity)
        .where(Activity.ip.isnot(None), Activity.created_at < cutoff)
        .values(ip=None)
    )
    db.commit()
    return res.rowcount


def list_for_gallery(db: Session, gallery_id: str, page: int = 1, limit: int = 20) -> tuple[list[Activity], int]:
    total = db.execute(
        select(func.count()).where(Activity.gallery_id == gallery_id)
    ).scalar_one()
    items = db.execute(
        select(Activity)
        .where(Activity.gallery_id == gallery_id)
        .order_by(Activity.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).scalars().all()
    return list(items), total
