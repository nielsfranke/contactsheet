# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Vector store for semantic search.

Vectors are kept in the main SQLite DB as raw little-endian float32 BLOBs, L2-normalized on write
so cosine similarity is a plain dot product on read. Ranking is brute-force in NumPy: for one
photographer's libraries (tens of thousands of images, ~512-dim vectors) a query scans a few tens
of MB and finishes in single-digit milliseconds — not worth a native vector extension (`sqlite-vec`)
in the backend image. The scan is scoped to a gallery subtree via a join on `images.gallery_id`, so
only the relevant rows are loaded. NumPy is imported lazily so a deploy that never enables search
pays nothing at startup.
"""

from __future__ import annotations

import logging

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.gallery import Gallery
from app.models.image import Image
from app.models.image_embedding import ImageEmbedding

logger = logging.getLogger(__name__)


def _pack(vector: list[float]):
    import numpy as np

    arr = np.asarray(vector, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm > 0:
        arr = arr / norm
    return arr.astype(np.float32)


def _mirror_to_vec(db: Session, fn) -> None:
    """Run a best-effort vec0 index update (when the sqlite-vec backend is enabled). The BLOB table
    is the source of truth, so a vec failure is logged and swallowed — the NumPy path still works."""
    from app import vector_index

    if not vector_index.enabled():
        return
    try:
        fn(vector_index)
        db.commit()
    except Exception:
        logger.warning("sqlite-vec index update failed; relying on the BLOB/NumPy path", exc_info=True)
        db.rollback()


def upsert(db: Session, image_id: str, model: str, vector: list[float]) -> ImageEmbedding:
    """Insert or replace the embedding for an image (one row per image, for the current model)."""
    arr = _pack(vector)
    row = db.get(ImageEmbedding, image_id)
    if row is None:
        row = ImageEmbedding(image_id=image_id, model=model, dim=int(arr.shape[0]), vector=arr.tobytes())
        db.add(row)
    else:
        row.model = model
        row.dim = int(arr.shape[0])
        row.vector = arr.tobytes()
    db.commit()
    _mirror_to_vec(db, lambda vi: vi.upsert(db, image_id, arr))
    return row


def delete(db: Session, image_id: str) -> None:
    db.execute(sa_delete(ImageEmbedding).where(ImageEmbedding.image_id == image_id))
    db.commit()
    _mirror_to_vec(db, lambda vi: vi.delete(db, image_id))


def delete_for_model_mismatch(db: Session, model: str) -> int:
    """Drop vectors produced by any *other* encoder (used when the configured model changes).
    Returns the number removed. The matching images are re-queued separately by the service."""
    result = db.execute(sa_delete(ImageEmbedding).where(ImageEmbedding.model != model))
    db.commit()
    return result.rowcount or 0


def count_for_model(db: Session, model: str) -> int:
    return int(
        db.execute(
            select(func.count()).select_from(ImageEmbedding).where(ImageEmbedding.model == model)
        ).scalar_one()
    )


def search(
    db: Session,
    query: list[float],
    model: str,
    gallery_ids: list[str] | None = None,
    limit: int = 200,
) -> list[tuple[str, float]]:
    """Rank indexed images against a query vector. Returns (image_id, cosine_score) pairs sorted
    by descending similarity. Soft-deleted images are excluded. When `gallery_ids` is given the
    scan is limited to those galleries (the caller passes a gallery + its subtree)."""
    import numpy as np

    # Instance-wide search (no gallery scope) is the 100k+ pain point — route it through the
    # sqlite-vec index when enabled, falling back to the NumPy scan on any error. Gallery-scoped
    # search stays on NumPy (a subtree's vectors are few; scoping vec0's KNN would over-fetch).
    if gallery_ids is None:
        from app import vector_index

        if vector_index.enabled():
            try:
                q = np.asarray(query, dtype=np.float32)
                norm = float(np.linalg.norm(q))
                if norm > 0:
                    q = q / norm
                return vector_index.search_global(db, q.tolist(), limit)
            except Exception:
                logger.warning("sqlite-vec search failed; falling back to NumPy", exc_info=True)

    stmt = (
        select(ImageEmbedding.image_id, ImageEmbedding.vector)
        .join(Image, Image.id == ImageEmbedding.image_id)
        .join(Gallery, Gallery.id == Image.gallery_id)
        .where(
            ImageEmbedding.model == model,
            Image.deleted_at.is_(None),
            Gallery.deleted_at.is_(None),
        )
    )
    if gallery_ids is not None:
        if not gallery_ids:
            return []
        stmt = stmt.where(Image.gallery_id.in_(gallery_ids))

    rows = db.execute(stmt).all()
    if not rows:
        return []

    q = np.asarray(query, dtype=np.float32)
    norm = float(np.linalg.norm(q))
    if norm > 0:
        q = q / norm

    ids = [r[0] for r in rows]
    matrix = np.frombuffer(b"".join(r[1] for r in rows), dtype=np.float32).reshape(len(rows), -1)
    if matrix.shape[1] != q.shape[0]:
        # Dimension mismatch (e.g. a half-finished model swap) — nothing comparable yet.
        return []
    # NumPy 2.x + Apple Accelerate emits spurious "divide by zero / overflow / invalid value
    # encountered in matmul" RuntimeWarnings on arm64 for read-only frombuffer arrays, even though
    # the result is correct. Silence them locally; guard correctness via the finite check below.
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        scores = matrix @ q
    scores = np.nan_to_num(scores, nan=-1.0, posinf=-1.0, neginf=-1.0)
    order = np.argsort(-scores)[:limit]
    return [(ids[i], float(scores[i])) for i in order]
