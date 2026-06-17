# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.database import get_db
from app.repositories import gallery_repo, image_repo, zip_job_repo
from app.schemas.zip_job import ZipJobCreate, ZipJobResponse
from app.tasks.zip_task import build_zip, build_zip_for_images, build_zip_multi, safe_folder

router = APIRouter(prefix="/api/galleries", tags=["zip"])


def _to_response(job) -> ZipJobResponse:
    download_url = None
    if job.status == "ready":
        download_url = f"/api/galleries/{job.gallery_id}/export/zip/{job.id}/download"
    return ZipJobResponse(
        id=job.id,
        gallery_id=job.gallery_id,
        status=job.status,
        filter_type=job.filter_type,
        image_count=job.image_count,
        error_message=job.error_message,
        created_at=job.created_at,
        ready_at=job.ready_at,
        download_url=download_url,
    )


@router.post("/{gallery_id}/export/zip", response_model=ZipJobResponse, status_code=202)
def create_zip_job(
    gallery_id: str,
    body: ZipJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    # Cleanup expired ZIPs before creating new one
    zip_job_repo.purge_expired(db)

    # Filtered download: a specific selection of this gallery's images (flat archive).
    if body.image_ids:
        gallery_image_ids = {img.id for img in image_repo.get_by_gallery(db, gallery_id)}
        wanted = [iid for iid in body.image_ids if iid in gallery_image_ids]
        if not wanted:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to download in the current selection")
        job = zip_job_repo.create(db, gallery_id, "all")
        background_tasks.add_task(build_zip_for_images, job.id, gallery_id, wanted)
        return _to_response(job)

    # Multi-gallery download: this gallery plus selected sub-galleries, each in a named folder.
    if body.subgallery_ids:
        children = gallery_repo.get_children(db, gallery_id)
        selected = [c for c in children if c.id in set(body.subgallery_ids)]
        ids = [gallery_id] + [c.id for c in selected]
        counts = gallery_repo.batch_image_counts(db, ids)
        entries: list[tuple[str, str]] = []
        if not selected:
            entries.append((gallery_id, ""))
        else:
            if counts.get(gallery_id, 0) > 0:
                entries.append((gallery_id, safe_folder(gallery.name)))
            for c in selected:
                entries.append((c.id, safe_folder(c.name)))
        if sum(counts.get(gid, 0) for gid, _ in entries) == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to download in the current selection")
        job = zip_job_repo.create(db, gallery_id, "all")
        background_tasks.add_task(build_zip_multi, job.id, entries)
        return _to_response(job)

    job = zip_job_repo.create(db, gallery_id, body.filter_type)
    background_tasks.add_task(build_zip, job.id, gallery_id, body.filter_type)
    return _to_response(job)


@router.get("/{gallery_id}/export/zip", response_model=list[ZipJobResponse])
def list_zip_jobs(
    gallery_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    jobs = zip_job_repo.list_for_gallery(db, gallery_id)
    return [_to_response(j, "") for j in jobs]


@router.get("/{gallery_id}/export/zip/{job_id}", response_model=ZipJobResponse)
def get_zip_job(
    gallery_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    job = zip_job_repo.get(db, job_id)
    if not job or job.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return _to_response(job)


@router.get("/{gallery_id}/export/zip/{job_id}/download")
def download_zip(
    gallery_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    job = zip_job_repo.get(db, job_id)
    if not job or job.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if job.status != "ready" or not job.file_path:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="ZIP not ready")
    if not os.path.exists(job.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ZIP file missing")

    filename = f"gallery-{gallery_id[:8]}-{job.filter_type}.zip"
    return FileResponse(
        job.file_path,
        media_type="application/zip",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{gallery_id}/export/zip/{job_id}", status_code=204)
def delete_zip_job(
    gallery_id: str,
    job_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    job = zip_job_repo.get(db, job_id)
    if not job or job.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if job.file_path and os.path.exists(job.file_path):
        os.unlink(job.file_path)
    db.delete(job)
    db.commit()
