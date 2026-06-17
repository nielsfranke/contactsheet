# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.zip_job import ZipJob


def create(db: Session, gallery_id: str, filter_type: str) -> ZipJob:
    job = ZipJob(
        id=str(uuid.uuid4()),
        gallery_id=gallery_id,
        status="pending",
        filter_type=filter_type,
        created_at=datetime.now(timezone.utc),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get(db: Session, job_id: str) -> ZipJob | None:
    return db.get(ZipJob, job_id)


def update_status(
    db: Session,
    job: ZipJob,
    status: str,
    file_path: str | None = None,
    image_count: int | None = None,
    error_message: str | None = None,
) -> ZipJob:
    job.status = status
    if file_path is not None:
        job.file_path = file_path
    if image_count is not None:
        job.image_count = image_count
    if error_message is not None:
        job.error_message = error_message
    if status == "ready":
        job.ready_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return job


def list_for_gallery(db: Session, gallery_id: str) -> list[ZipJob]:
    return db.execute(
        select(ZipJob).where(ZipJob.gallery_id == gallery_id).order_by(ZipJob.created_at.desc())
    ).scalars().all()


def purge_expired(db: Session) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=settings.zip_ttl_hours)).replace(tzinfo=None)
    old_jobs = db.execute(
        select(ZipJob).where(ZipJob.created_at < cutoff)
    ).scalars().all()
    count = 0
    for job in old_jobs:
        if job.file_path:
            import os
            try:
                os.unlink(job.file_path)
            except OSError:
                pass
        db.delete(job)
        count += 1
    if count:
        db.commit()
    return count
