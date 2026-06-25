# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Optional sqlite-vec acceleration for instance-wide semantic search.

The brute-force NumPy ranking in `image_embedding_repo` is fine to ~tens of thousands of vectors,
but an **instance-wide** query (no gallery scope) at 100k+ means loading every BLOB into Python.
When enabled, this module maintains a `vec0` virtual-table index and runs that one query as KNN in
C/SQL instead. Everything here is:

- **Off by default.** Gated by `settings.semantic_search_vec`; a default deploy never loads the
  extension (zero startup/runtime cost) — same "opt-in, stay light" posture as the ML sidecar.
- **A derived index, not the source of truth.** `image_embeddings` (the normalized float32 BLOBs)
  remains authoritative and powers the NumPy path; vec0 is rebuilt from it.
- **Fail-safe.** Any load/query failure falls back to NumPy, so search never hard-breaks on the
  young native extension.

Gallery-scoped search stays on NumPy: a subtree's vectors are few, and scoping vec0's KNN by a set
of gallery ids would need over-fetching that defeats the point. The win is the global query.

See docs/architecture/semantic-search-scale.md.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)

_VEC_TABLE = "vec_image_embeddings"
_META_TABLE = "vec_index_meta"


def enabled() -> bool:
    """Whether the operator opted into the sqlite-vec backend (read dynamically)."""
    return bool(getattr(settings, "semantic_search_vec", False))


def available(db: Session) -> bool:
    """True if the sqlite-vec extension is actually loaded on this session's connection."""
    try:
        db.execute(text("SELECT vec_version()"))
        return True
    except Exception:
        return False


def load_into(dbapi_conn) -> bool:
    """Load the sqlite-vec extension onto a raw DBAPI connection. Called from the engine connect
    hook only when enabled. Returns False (and logs once) if the extension can't be loaded, so the
    caller can carry on without it — queries then use the NumPy fallback."""
    try:
        import sqlite_vec

        dbapi_conn.enable_load_extension(True)
        sqlite_vec.load(dbapi_conn)
        dbapi_conn.enable_load_extension(False)
        return True
    except Exception as exc:  # extension missing, or SQLite built without load_extension
        logger.warning("sqlite-vec enabled but could not be loaded (%s); using NumPy ranking", exc)
        return False


def _serialize(vector) -> bytes:
    import sqlite_vec

    return sqlite_vec.serialize_float32([float(x) for x in vector])


def _current_dim(db: Session) -> int | None:
    db.execute(text(f"CREATE TABLE IF NOT EXISTS {_META_TABLE} (id INTEGER PRIMARY KEY CHECK (id = 1), dim INTEGER NOT NULL)"))
    row = db.execute(text(f"SELECT dim FROM {_META_TABLE} WHERE id = 1")).fetchone()
    return int(row[0]) if row else None


def ensure_table(db: Session, dim: int) -> None:
    """Create the vec0 table for `dim`, recreating it if a table for a different dim exists (a model
    swap can change the dimensionality). vec0's dimension is fixed at creation, hence the meta row."""
    current = _current_dim(db)
    if current == dim:
        return
    db.execute(text(f"DROP TABLE IF EXISTS {_VEC_TABLE}"))
    # distance_metric=cosine matches the NumPy cosine ranking; vectors are already L2-normalized.
    db.execute(text(
        f"CREATE VIRTUAL TABLE {_VEC_TABLE} USING vec0("
        f"image_id TEXT PRIMARY KEY, embedding float[{dim}] distance_metric=cosine)"
    ))
    db.execute(text(f"INSERT INTO {_META_TABLE} (id, dim) VALUES (1, :d) "
                    f"ON CONFLICT(id) DO UPDATE SET dim = :d"), {"d": dim})


def upsert(db: Session, image_id: str, arr) -> None:
    """Mirror one embedding into the vec0 index (best-effort; caller wraps failures)."""
    ensure_table(db, int(arr.shape[0]))
    db.execute(text(f"DELETE FROM {_VEC_TABLE} WHERE image_id = :id"), {"id": image_id})
    db.execute(
        text(f"INSERT INTO {_VEC_TABLE} (image_id, embedding) VALUES (:id, :v)"),
        {"id": image_id, "v": _serialize(arr.tolist())},
    )


def delete(db: Session, image_id: str) -> None:
    if _current_dim(db) is None:
        return
    db.execute(text(f"DELETE FROM {_VEC_TABLE} WHERE image_id = :id"), {"id": image_id})


def rebuild(db: Session, model: str) -> None:
    """(Re)build the vec0 index from the authoritative BLOBs for `model`. Called when the feature is
    enabled or the model changes. No-op if the extension isn't loaded (the create will raise →
    caught by the caller, NumPy path stays in effect)."""
    import numpy as np

    from app.models.image_embedding import ImageEmbedding

    rows = db.execute(
        text("SELECT image_id, dim, vector FROM image_embeddings WHERE model = :m"), {"m": model}
    ).fetchall()
    if not rows:
        # Nothing to index yet; drop any stale table so a later upsert recreates it at the right dim.
        db.execute(text(f"DROP TABLE IF EXISTS {_VEC_TABLE}"))
        db.execute(text(f"DELETE FROM {_META_TABLE}"))
        db.commit()
        return

    dim = int(rows[0][1])
    ensure_table(db, dim)
    db.execute(text(f"DELETE FROM {_VEC_TABLE}"))
    for image_id, _d, blob in rows:
        arr = np.frombuffer(blob, dtype=np.float32)
        db.execute(
            text(f"INSERT INTO {_VEC_TABLE} (image_id, embedding) VALUES (:id, :v)"),
            {"id": image_id, "v": _serialize(arr.tolist())},
        )
    db.commit()
    _ = ImageEmbedding  # keep the import meaningful for callers reasoning about the source table
    logger.info("Rebuilt sqlite-vec index: %d vector(s), dim=%d", len(rows), dim)


def search_global(db: Session, query, limit: int) -> list[tuple[str, float]]:
    """KNN over the whole index (no gallery scope), excluding soft-deleted images/galleries.
    Returns (image_id, cosine_score) sorted by descending similarity. Over-fetches a little so
    soft-deleted vectors (still present in the index) don't shrink the result below `limit`."""
    if _current_dim(db) is None:
        return []
    k = min(limit * 2 + 16, 4096)
    rows = db.execute(
        text(
            f"WITH knn AS (SELECT image_id, distance FROM {_VEC_TABLE} "
            f"             WHERE embedding MATCH :q AND k = :k) "
            f"SELECT knn.image_id, knn.distance FROM knn "
            f"JOIN images i ON i.id = knn.image_id "
            f"JOIN galleries g ON g.id = i.gallery_id "
            f"WHERE i.deleted_at IS NULL AND g.deleted_at IS NULL "
            f"ORDER BY knn.distance"
        ),
        {"q": _serialize(query), "k": k},
    ).fetchall()
    # cosine distance → similarity; vectors are normalized so this matches the NumPy dot product.
    return [(image_id, 1.0 - float(distance)) for image_id, distance in rows[:limit]]
