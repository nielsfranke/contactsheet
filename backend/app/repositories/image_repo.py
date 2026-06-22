# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.models.gallery import Gallery
from app.models.image import Image

# IPTC value fields searched by the "All Photos" filter — the editorial text a photographer writes
# (Lightroom/Bridge). Keys are deliberately excluded (see _iptc_search_expr) so a query for a word
# like "title" or "city" doesn't match every tagged photo.
_IPTC_SEARCH_FIELDS = (
    "title", "headline", "description", "keywords",
    "creator", "credit", "copyright", "city", "state", "country",
)


def _iptc_search_expr():
    """A lowercased, space-joined string of the IPTC *values* (not the JSON keys), so a filename/
    keyword filter matches what the photographer actually wrote. `keywords` is an array; json_extract
    returns it as text, which substring-matches fine."""
    joined = func.coalesce(func.json_extract(Image.iptc_data, f"$.{_IPTC_SEARCH_FIELDS[0]}"), "")
    for field in _IPTC_SEARCH_FIELDS[1:]:
        joined = joined.op("||")(" ").op("||")(
            func.coalesce(func.json_extract(Image.iptc_data, f"$.{field}"), "")
        )
    return func.lower(joined)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_by_gallery(db: Session, gallery_id: str, only_approved: bool = False) -> list[Image]:
    stmt = select(Image).where(Image.gallery_id == gallery_id, Image.deleted_at.is_(None))
    if only_approved:
        stmt = stmt.where(Image.moderation_status == "approved")
    return db.execute(stmt.order_by(Image.sort_order)).scalars().all()


def count_by_gallery(db: Session, gallery_id: str, only_approved: bool = False) -> int:
    """Live (non-deleted) image count for a gallery — a COUNT(*), not a full row load."""
    stmt = select(func.count()).select_from(Image).where(
        Image.gallery_id == gallery_id, Image.deleted_at.is_(None)
    )
    if only_approved:
        stmt = stmt.where(Image.moderation_status == "approved")
    return db.execute(stmt).scalar_one()


def get_by_id(db: Session, image_id: str) -> Image | None:
    return db.execute(
        select(Image).where(Image.id == image_id, Image.deleted_at.is_(None))
    ).scalar_one_or_none()


def create(db: Session, **kwargs) -> Image:
    image = Image(**kwargs)
    db.add(image)
    db.commit()
    db.refresh(image)
    return image


def increment_likes(db: Session, image_id: str) -> Image:
    db.execute(update(Image).where(Image.id == image_id).values(likes=Image.likes + 1))
    db.commit()
    return db.get(Image, image_id)


def update_fields(db: Session, image: Image, **kwargs) -> Image:
    for key, value in kwargs.items():
        setattr(image, key, value)
    db.commit()
    db.refresh(image)
    return image


def soft_delete(db: Session, image: Image) -> Image:
    image.deleted_at = _now()
    db.commit()
    return image


def set_sort_orders(db: Session, gallery_id: str, ordered_ids: list[str]) -> None:
    """Bulk-update sort_order for a list of image IDs in the given order."""
    for i, image_id in enumerate(ordered_ids):
        db.execute(
            update(Image)
            .where(Image.id == image_id, Image.gallery_id == gallery_id)
            .values(sort_order=i)
        )
    db.commit()


def update_processing_result(
    db: Session,
    image_id: str,
    *,
    width: int | None,
    height: int | None,
    exif_data: str | None,
    iptc_data: str | None,
    status: str,
) -> None:
    db.execute(
        update(Image)
        .where(Image.id == image_id)
        .values(
            width=width,
            height=height,
            exif_data=exif_data,
            iptc_data=iptc_data,
            processing_status=status,
        )
    )
    db.commit()


def set_processing_error(db: Session, image_id: str) -> None:
    db.execute(
        update(Image).where(Image.id == image_id).values(processing_status="error")
    )
    db.commit()


def get_many(db: Session, image_ids: list[str]) -> dict[str, Image]:
    """Fetch live images by id, returned as an id→Image map (order-free; caller re-orders)."""
    if not image_ids:
        return {}
    rows = db.execute(
        select(Image).where(Image.id.in_(image_ids), Image.deleted_at.is_(None))
    ).scalars().all()
    return {img.id: img for img in rows}


def ids_needing_embedding(db: Session) -> list[str]:
    """IDs of indexable images not yet embedded (status pending/error). "Indexable" = live, non-video,
    AND in a live gallery — a soft-deleted gallery keeps its image rows (their own deleted_at stays
    NULL) but its files are gone, so those must be excluded or they'd fail forever. Drives the
    backfill when search is first enabled or the encoder model changes."""
    stmt = (
        select(Image.id)
        .join(Gallery, Gallery.id == Image.gallery_id)
        .where(
            Image.deleted_at.is_(None),
            Gallery.deleted_at.is_(None),
            Image.is_video.is_(False),
            Image.embedding_status.in_(("pending", "error")),
        )
    )
    return list(db.execute(stmt).scalars().all())


def set_embedding_status(db: Session, image_id: str, status: str) -> None:
    db.execute(
        update(Image).where(Image.id == image_id).values(embedding_status=status)
    )
    db.commit()


def list_all(
    db: Session, sort: str, direction: str, limit: int, offset: int, name_filter: str | None = None
) -> tuple[list[Image], int]:
    """A page of every photo across live galleries (the cross-gallery "All Photos" browser).
    Non-video, live images in live galleries. `sort` is "date" (added) or "name"; `name_filter`
    narrows by **filename, gallery name, or IPTC metadata** (keywords/caption/title/location/creator)
    — the fallback "search" when semantic search is off. Returns (page items, total count). A
    secondary id ordering keeps pagination stable across pages."""
    order_col = {"date": Image.created_at, "name": Image.original_filename}.get(
        sort, Image.created_at
    )
    ordering = order_col.asc() if direction == "asc" else order_col.desc()

    where = [
        Image.deleted_at.is_(None),
        Gallery.deleted_at.is_(None),
        Image.is_video.is_(False),
    ]
    if name_filter:
        needle = name_filter.lower()
        where.append(
            or_(
                func.lower(Image.original_filename).contains(needle),
                func.lower(Gallery.name).contains(needle),
                _iptc_search_expr().contains(needle),
            )
        )
    where = tuple(where)
    total = int(
        db.execute(
            select(func.count())
            .select_from(Image)
            .join(Gallery, Gallery.id == Image.gallery_id)
            .where(*where)
        ).scalar_one()
    )
    items = list(
        db.execute(
            select(Image)
            .join(Gallery, Gallery.id == Image.gallery_id)
            .where(*where)
            .order_by(ordering, Image.id)
            .limit(limit)
            .offset(offset)
        ).scalars().all()
    )
    return items, total


def embedding_status_counts(db: Session) -> dict[str, int]:
    """Indexable-image counts grouped by embedding_status (for the search settings panel). Scoped
    to live images in live galleries, so orphan rows from a soft-deleted gallery don't inflate the
    'failed' tally."""
    rows = db.execute(
        select(Image.embedding_status, func.count())
        .join(Gallery, Gallery.id == Image.gallery_id)
        .where(Image.deleted_at.is_(None), Gallery.deleted_at.is_(None), Image.is_video.is_(False))
        .group_by(Image.embedding_status)
    ).all()
    return {status: int(count) for status, count in rows}


def reset_embedding_status(db: Session) -> None:
    """Mark every live, non-video image as needing (re)indexing; videos become 'skipped'.
    Used when the encoder model changes so the whole library is re-embedded."""
    live_galleries = select(Gallery.id).where(Gallery.deleted_at.is_(None))
    db.execute(
        update(Image)
        .where(
            Image.deleted_at.is_(None),
            Image.is_video.is_(False),
            Image.gallery_id.in_(live_galleries),
        )
        .values(embedding_status="pending")
    )
    db.execute(
        update(Image).where(Image.is_video.is_(True)).values(embedding_status="skipped")
    )
    db.commit()
