# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.comment import Comment
from app.models.gallery import Gallery
from app.models.image import Image


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_all_active(db: Session) -> list[Gallery]:
    return db.execute(
        select(Gallery).where(Gallery.deleted_at.is_(None)).order_by(Gallery.sort_order)
    ).scalars().all()


def get_by_id(db: Session, gallery_id: str) -> Gallery | None:
    return db.execute(
        select(Gallery).where(Gallery.id == gallery_id, Gallery.deleted_at.is_(None))
    ).scalar_one_or_none()


def get_by_share_token(db: Session, share_token: str) -> Gallery | None:
    return db.execute(
        select(Gallery).where(Gallery.share_token == share_token, Gallery.deleted_at.is_(None))
    ).scalar_one_or_none()


def share_token_exists(db: Session, token: str, exclude_id: str | None = None) -> bool:
    """Whether any gallery (including soft-deleted ones, since the column's unique
    constraint covers them) already uses this share token."""
    stmt = select(Gallery.id).where(Gallery.share_token == token)
    if exclude_id:
        stmt = stmt.where(Gallery.id != exclude_id)
    return db.execute(stmt.limit(1)).scalar_one_or_none() is not None


def get_children(db: Session, parent_id: str) -> list[Gallery]:
    return db.execute(
        select(Gallery).where(Gallery.parent_id == parent_id, Gallery.deleted_at.is_(None))
    ).scalars().all()


def get_descendants(db: Session, gallery_id: str) -> list[Gallery]:
    """Every live descendant of a gallery (unlimited nesting), excluding the gallery itself.

    Same BFS frontier walk as soft_delete / descendant_ids — used to cascade settings to the
    whole subtree, not just direct children."""
    descendants: list[Gallery] = []
    frontier = [gallery_id]
    while frontier:
        children = db.execute(
            select(Gallery).where(Gallery.parent_id.in_(frontier), Gallery.deleted_at.is_(None))
        ).scalars().all()
        descendants.extend(children)
        frontier = [child.id for child in children]
    return descendants


def create(db: Session, **kwargs) -> Gallery:
    gallery = Gallery(**kwargs)
    db.add(gallery)
    db.commit()
    db.refresh(gallery)
    return gallery


def update(db: Session, gallery: Gallery, **kwargs) -> Gallery:
    for key, value in kwargs.items():
        setattr(gallery, key, value)
    gallery.updated_at = _now()
    db.commit()
    db.refresh(gallery)
    return gallery


def soft_delete(db: Session, gallery: Gallery) -> Gallery:
    now = _now()
    gallery.deleted_at = now
    gallery.updated_at = now
    # Cascade to the entire subtree (nesting is unlimited), not just direct children, so no
    # descendant is left live and reachable via its own share token after the parent is deleted.
    frontier = [gallery.id]
    while frontier:
        children = db.execute(
            select(Gallery).where(Gallery.parent_id.in_(frontier), Gallery.deleted_at.is_(None))
        ).scalars().all()
        frontier = []
        for child in children:
            child.deleted_at = now
            child.updated_at = now
            frontier.append(child.id)
    db.commit()
    return gallery


def get_by_ids(db: Session, gallery_ids: list[str]) -> dict[str, Gallery]:
    """Fetch galleries by id as an id→Gallery map (for attaching gallery context to search hits)."""
    if not gallery_ids:
        return {}
    rows = db.execute(select(Gallery).where(Gallery.id.in_(gallery_ids))).scalars().all()
    return {g.id: g for g in rows}


def descendant_ids(db: Session, gallery_id: str) -> list[str]:
    """The gallery's id plus every live descendant's id (unlimited nesting), via the same
    frontier walk as soft_delete. Used to scope a semantic search to a gallery subtree."""
    ids = [gallery_id]
    frontier = [gallery_id]
    while frontier:
        children = db.execute(
            select(Gallery.id).where(
                Gallery.parent_id.in_(frontier), Gallery.deleted_at.is_(None)
            )
        ).scalars().all()
        frontier = list(children)
        ids.extend(frontier)
    return ids


def count_images(db: Session, gallery_id: str, only_approved: bool = False) -> int:
    stmt = select(func.count()).where(Image.gallery_id == gallery_id, Image.deleted_at.is_(None))
    if only_approved:
        stmt = stmt.where(Image.moderation_status == "approved")
    return db.execute(stmt).scalar_one()


def get_cover_image(db: Session, gallery: Gallery) -> Image | None:
    if gallery.cover_image_id:
        img = db.execute(
            select(Image).where(Image.id == gallery.cover_image_id, Image.deleted_at.is_(None))
        ).scalar_one_or_none()
        if img:
            return img
    return db.execute(
        select(Image)
        .where(Image.gallery_id == gallery.id, Image.deleted_at.is_(None))
        .order_by(Image.sort_order)
        .limit(1)
    ).scalar_one_or_none()


def get_auto_header_candidates(db: Session, gallery_id: str) -> list[tuple[str, str]]:
    """Eligible still photos for an auto-header as (id, stored_filename), ordered by sort_order.
    Public-safe: approved + fully processed + non-video only (a container yields an empty list)."""
    rows = db.execute(
        select(Image.id, Image.stored_filename)
        .where(
            Image.gallery_id == gallery_id,
            Image.deleted_at.is_(None),
            Image.is_video.is_(False),
            Image.processing_status == "done",
            Image.moderation_status == "approved",
        )
        .order_by(Image.sort_order)
    ).all()
    return [(r[0], r[1]) for r in rows]


def batch_image_counts(
    db: Session, gallery_ids: list[str], only_approved: bool = False
) -> dict[str, int]:
    if not gallery_ids:
        return {}
    stmt = (
        select(Image.gallery_id, func.count(Image.id))
        .where(Image.gallery_id.in_(gallery_ids), Image.deleted_at.is_(None))
    )
    if only_approved:
        stmt = stmt.where(Image.moderation_status == "approved")
    rows = db.execute(stmt.group_by(Image.gallery_id)).all()
    return {row[0]: row[1] for row in rows}


def batch_cover_images(db: Session, galleries: list[Gallery]) -> dict[str, Image]:
    if not galleries:
        return {}
    result: dict[str, Image] = {}

    # Galleries with an explicit cover_image_id pinned
    pinned = {g.id: g.cover_image_id for g in galleries if g.cover_image_id}
    auto_ids = [g.id for g in galleries if not g.cover_image_id]

    if pinned:
        imgs = db.execute(
            select(Image).where(Image.id.in_(pinned.values()), Image.deleted_at.is_(None))
        ).scalars().all()
        img_by_id = {img.id: img for img in imgs}
        for gid, img_id in pinned.items():
            if img_id in img_by_id:
                result[gid] = img_by_id[img_id]
            # If pinned image was deleted, fall through to auto logic below
            elif gid not in result:
                auto_ids.append(gid)

    if auto_ids:
        sub = (
            select(Image.gallery_id, func.min(Image.sort_order).label("min_sort"))
            .where(
                Image.gallery_id.in_(auto_ids),
                Image.deleted_at.is_(None),
                Image.processing_status == "done",
            )
            .group_by(Image.gallery_id)
            .subquery()
        )
        rows = db.execute(
            select(Image)
            .join(sub, (Image.gallery_id == sub.c.gallery_id) & (Image.sort_order == sub.c.min_sort))
        ).scalars().all()
        for img in rows:
            result[img.gallery_id] = img

    return result


def empty(db: Session, gallery: Gallery) -> None:
    now = _now()

    def _delete_images(gallery_id: str) -> None:
        images = db.execute(
            select(Image).where(Image.gallery_id == gallery_id, Image.deleted_at.is_(None))
        ).scalars().all()
        for img in images:
            img.deleted_at = now

    # Soft-delete this gallery's own images, then cascade to the entire descendant subtree
    # (nesting is unlimited) so no grandchild gallery is left live after the parent is emptied.
    # Mirrors soft_delete's BFS — the only difference is this gallery itself stays live.
    _delete_images(gallery.id)
    frontier = [gallery.id]
    while frontier:
        children = db.execute(
            select(Gallery).where(Gallery.parent_id.in_(frontier), Gallery.deleted_at.is_(None))
        ).scalars().all()
        frontier = []
        for child in children:
            child.deleted_at = now
            child.updated_at = now
            _delete_images(child.id)
            frontier.append(child.id)
    db.commit()


def batch_comment_counts(db: Session, gallery_ids: list[str]) -> dict[str, int]:
    if not gallery_ids:
        return {}
    rows = db.execute(
        select(Image.gallery_id, func.count(Comment.id))
        .join(Comment, Comment.image_id == Image.id)
        .where(Image.gallery_id.in_(gallery_ids), Image.deleted_at.is_(None))
        .group_by(Image.gallery_id)
    ).all()
    return {row[0]: row[1] for row in rows}


def get_flagged_images(db: Session, gallery_id: str, flag: str | None = None) -> list[Image]:
    """Return non-deleted images with a color_flag set. Optionally filter by specific flag."""
    stmt = select(Image).where(
        Image.gallery_id == gallery_id,
        Image.deleted_at.is_(None),
        Image.color_flag != "none",
    )
    if flag:
        stmt = stmt.where(Image.color_flag == flag)
    return db.execute(stmt.order_by(Image.sort_order)).scalars().all()
