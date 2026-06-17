# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.realtime import publish as realtime_publish
from app.repositories import activity_repo, comment_repo, image_repo
from app.schemas.comment import CommentCreate, CommentResponse, CommentUpdate
from app.services import notification_service


def list_comments(db: Session, image_id: str) -> list[CommentResponse]:
    image = image_repo.get_by_id(db, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    comments = comment_repo.list_by_image(db, image_id)
    return [CommentResponse.model_validate(c) for c in comments]


def delete_comment(
    db: Session,
    gallery_id: str,
    image_id: str,
    comment_id: str,
    *,
    requester_name: str | None = None,
    is_admin: bool = False,
) -> None:
    """Delete a comment/annotation. Admins may delete any; a public caller only their own
    (author_name matches the supplied reviewer name, case-insensitively)."""
    comment = comment_repo.get_by_id(db, comment_id)
    if not comment or comment.image_id != image_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    if not is_admin:
        name = (requester_name or "").strip().lower()
        if not name or comment.author_name.strip().lower() != name:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="You can only delete your own comments"
            )
    comment_repo.delete(db, comment)
    realtime_publish(gallery_id, "comment", image_id=image_id)


def edit_comment(
    db: Session,
    gallery_id: str,
    image_id: str,
    comment_id: str,
    data: CommentUpdate,
) -> CommentResponse:
    """Edit a comment/annotation's text. Admin-only (callers must enforce auth); the author and any
    spatial anchor are left untouched."""
    comment = comment_repo.get_by_id(db, comment_id)
    if not comment or comment.image_id != image_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    image = image_repo.get_by_id(db, image_id)
    if not image or image.gallery_id != gallery_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    comment = comment_repo.update_text(db, comment, data.text)
    realtime_publish(gallery_id, "comment", image_id=image_id)
    return CommentResponse.model_validate(comment)


def add_comment(db: Session, image_id: str, data: CommentCreate) -> CommentResponse:
    image = image_repo.get_by_id(db, image_id)
    if not image:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    anchored = data.anchor is not None
    comment = comment_repo.create(
        db,
        id=str(uuid.uuid4()),
        image_id=image_id,
        author_name=data.author_name,
        text=data.text,
        anchor=data.anchor.model_dump(exclude_none=True) if anchored else None,
        created_at=datetime.now(timezone.utc),
    )
    try:
        activity_repo.log(
            db,
            image.gallery_id,
            # An anchored comment is an annotation — distinct verb in the activity log.
            "annotated" if anchored else "commented",
            data.author_name,
            image_id=image_id,
            meta={"preview": data.text[:80]},
        )
    except Exception:
        pass
    notification_service.enqueue(
        db, image.gallery_id, "annotation" if anchored else "comment", data.author_name,
        meta={"image_id": image_id, "preview": data.text[:80], "anchored": anchored},
    )
    realtime_publish(
        image.gallery_id, "annotation" if anchored else "comment", image_id=image_id,
    )
    return CommentResponse.model_validate(comment)
