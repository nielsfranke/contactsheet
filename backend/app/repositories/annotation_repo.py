# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.annotation import Annotation


def list_for_image(db: Session, image_id: str) -> list[Annotation]:
    return db.execute(
        select(Annotation).where(Annotation.image_id == image_id).order_by(Annotation.created_at)
    ).scalars().all()


def upsert(db: Session, image_id: str, reviewer_name: str | None, annotation_data: list) -> Annotation:
    existing = None
    if reviewer_name is not None:
        existing = db.execute(
            select(Annotation).where(
                Annotation.image_id == image_id,
                Annotation.reviewer_name == reviewer_name,
            )
        ).scalar_one_or_none()

    if existing:
        existing.annotation_data = json.dumps(annotation_data)
        db.commit()
        db.refresh(existing)
        return existing

    annotation = Annotation(
        id=str(uuid.uuid4()),
        image_id=image_id,
        reviewer_name=reviewer_name,
        annotation_data=json.dumps(annotation_data),
        created_at=datetime.now(timezone.utc),
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return annotation


def delete(db: Session, annotation_id: str) -> bool:
    annotation = db.get(Annotation, annotation_id)
    if not annotation:
        return False
    db.delete(annotation)
    db.commit()
    return True


def count_for_image(db: Session, image_id: str) -> int:
    from sqlalchemy import func
    return db.execute(
        select(func.count()).where(Annotation.image_id == image_id)
    ).scalar_one()
