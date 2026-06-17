# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.notification import NotificationOutbox


def enqueue(
    db: Session,
    gallery_id: str,
    event_type: str,
    author: str | None = None,
    meta: dict | None = None,
) -> NotificationOutbox:
    row = NotificationOutbox(
        id=str(uuid.uuid4()),
        gallery_id=gallery_id,
        event_type=event_type,
        author=author,
        meta=json.dumps(meta) if meta else None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    return row


def list_pending(db: Session) -> list[NotificationOutbox]:
    """All unsent rows, ordered so they group cleanly by gallery."""
    return list(
        db.execute(
            select(NotificationOutbox)
            .where(NotificationOutbox.sent_at.is_(None))
            .order_by(NotificationOutbox.gallery_id, NotificationOutbox.created_at)
        ).scalars().all()
    )


def mark_sent(db: Session, ids: list[str]) -> None:
    if not ids:
        return
    db.execute(
        update(NotificationOutbox)
        .where(NotificationOutbox.id.in_(ids))
        .values(sent_at=datetime.now(timezone.utc))
    )
    db.commit()
