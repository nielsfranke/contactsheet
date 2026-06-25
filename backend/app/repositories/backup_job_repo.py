# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.backup_job import BackupJob


def create(db: Session, scope: str, include_renditions: bool) -> BackupJob:
    job = BackupJob(
        id=str(uuid.uuid4()),
        status="pending",
        scope=scope,
        include_renditions=include_renditions,
        created_at=datetime.now(timezone.utc),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get(db: Session, job_id: str) -> BackupJob | None:
    return db.get(BackupJob, job_id)


def update_status(
    db: Session,
    job: BackupJob,
    status: str,
    file_path: str | None = None,
    size_bytes: int | None = None,
    error_message: str | None = None,
) -> BackupJob:
    job.status = status
    if file_path is not None:
        job.file_path = file_path
    if size_bytes is not None:
        job.size_bytes = size_bytes
    if error_message is not None:
        job.error_message = error_message
    if status == "ready":
        job.ready_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return job


def list_all(db: Session) -> list[BackupJob]:
    return db.execute(
        select(BackupJob).order_by(BackupJob.created_at.desc())
    ).scalars().all()


def purge_expired(db: Session) -> int:
    """Drop backup jobs (and their files) older than the ZIP TTL. Backups are large; we
    don't keep them on the server indefinitely — the operator downloads and stores them."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=settings.zip_ttl_hours)).replace(tzinfo=None)
    old_jobs = db.execute(
        select(BackupJob).where(BackupJob.created_at < cutoff)
    ).scalars().all()
    count = 0
    for job in old_jobs:
        if job.file_path and os.path.exists(job.file_path):
            try:
                os.unlink(job.file_path)
            except OSError:
                pass
        db.delete(job)
        count += 1
    if count:
        db.commit()
    return count
