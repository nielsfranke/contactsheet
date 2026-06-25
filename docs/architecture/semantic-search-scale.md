<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Semantic-search scale (sqlite-vec)

**Status:** implemented (2026-06-25) on branch `feature/perf-scale`.

> Implementation notes vs. this proposal (two deliberate refinements):
> 1. **Opt-in flag, not the search toggle.** Gated by `settings.semantic_search_vec`
>    (env `SEMANTIC_SEARCH_VEC`), default off — so tests and default deploys stay on
>    NumPy and never load the extension, and an operator rolls the backend out
>    explicitly. The connect hook loads sqlite-vec only when the flag is on.
> 2. **Accelerates instance-wide search only.** vec0's KNN can't cheaply filter by a
>    set of gallery ids, so **gallery-scoped** search stays on NumPy (a subtree's
>    vectors are few — NumPy is already fine there). The 100k+ pain point is the
>    *global* query, which vec0 handles. All of `app/vector_index.py`; the BLOB table
>    stays source-of-truth + NumPy fallback. Covered by `tests/test_semantic_search_vec.py`.

## Goal

Lift the ceiling on semantic search. Today `image_embedding_repo.search` loads **every
matching vector BLOB into Python** and does a NumPy matmul per query. That's fine to
~tens of thousands of vectors (the repo docstring says as much), but instance-wide
search at **100k+** vectors means concatenating ~200 MB into Python per query — slow
and memory-heavy. Move the K-nearest-neighbour scan into **sqlite-vec** (KNN in C/SQL,
no per-query Python load), while keeping the feature **light and off-by-default**.

## Why sqlite-vec fits the "keep it light" bar

- **160 KB** native wheel per platform; official **manylinux x86_64 + aarch64** wheels
  exist, so the existing multi-arch image build picks them up with no extra steps.
- **Loaded only when semantic search is enabled** — which already requires opting in
  *and* running the separate ML sidecar. A default deploy never loads the extension:
  zero startup cost, zero memory, zero runtime change.
- At scale it's the **lower-memory** option (streams through C) vs. an in-process matrix
  cache that would hold ~200 MB resident.

## Design: vec0 as a derived query index; BLOBs stay the source of truth

Keep `image_embeddings` (the normalized float32 BLOBs) exactly as is — it remains the
**source of truth** and powers the **NumPy fallback**. Add a **`vec0` virtual table as
a derived index** used only to accelerate queries when the extension is loaded:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS vec_image_embeddings
USING vec0(image_id TEXT PRIMARY KEY, embedding float[<dim>]);
```

- **Dim is fixed per vec0 table.** Only one model is active at a time (a model swap
  already re-indexes), so the table is created for the active model's dim; a dim change
  drops + recreates it. Created **at runtime** (`CREATE VIRTUAL TABLE IF NOT EXISTS`)
  the first time search is enabled — **no Alembic migration** (the extension can't be
  assumed at migrate time; this keeps the schema portable for non-search deploys).
- **Writes stay dual, cheaply:** `upsert`/`delete` also write the vec0 row *when the
  extension is loaded*. The BLOB write is unchanged.
- **Backfill on enable:** when search is turned on (or the model changes),
  `on_settings_change` populates vec0 from the existing BLOBs (a one-time scan), the
  same hook that already re-queues indexing.

### Query path with automatic fallback

`image_embedding_repo.search` becomes:

1. If the vec0 index is available → KNN in SQL, with the gallery-subtree filter pushed
   into the query:
   ```sql
   SELECT e.image_id, e.distance
   FROM vec_image_embeddings e
   JOIN images i ON i.id = e.image_id
   JOIN galleries g ON g.id = i.gallery_id
   WHERE e.embedding MATCH :q AND k = :limit
     AND i.deleted_at IS NULL AND g.deleted_at IS NULL
     AND i.gallery_id IN (:subtree)
   ```
   (cosine distance → similarity = `1 - distance`; vectors are already L2-normalized.)
2. **Else → today's NumPy path, unchanged.** So search never hard-depends on the
   extension loading.

### Loading the extension (lazily, guarded)

In the `database.py` connect hook, **only when search is enabled**, attempt:
```python
conn.enable_load_extension(True); sqlite_vec.load(conn); conn.enable_load_extension(False)
```
wrapped in `try/except` → on any failure, log once and leave the connection without the
extension (the query path then uses the NumPy fallback). Toggling search on disposes the
pool so fresh connections pick up the extension. CPython's `sqlite3` here and the Docker
Debian SQLite both support `enable_load_extension`.

## Correctness invariants (unchanged)

- **Access control still post-filters.** Search returns image ids; hydration goes
  through the normal `image_service` serializer, so soft-delete/moderation/watermark
  rules still apply. The vec0 join excludes soft-deleted rows as the NumPy path does.
- **One row per image per model** — vec0 keyed by `image_id`, mirroring the BLOB table.
- Results are **exact KNN** (sqlite-vec brute-force in C), so ranking matches the NumPy
  path within float tolerance — no approximate-recall regression.

## Risks / mitigations

- **Young library (v0.1.9), native extension.** Mitigation: the lazy-load is
  try/except'd and the NumPy fallback is always present, so a load failure degrades to
  today's behaviour, never an outage. A startup log line records which path is active.
- **vec0 ↔ BLOB drift.** Both are written in the same `upsert`/`delete`; the backfill
  rebuilds vec0 from BLOBs, so the BLOB table can always reconstruct the index. Add a
  test asserting vec0 and NumPy return the same top-K for a fixed corpus.
- **Pip/CI** — `sqlite-vec` is pinned in `requirements.txt`; the weekly pip-audit and
  the new test workflow cover it. (It's imported lazily, so import cost is paid only
  when search is enabled.)

## Files (estimate)

| File | Change |
|---|---|
| `backend/requirements.txt` | add `sqlite-vec` (pinned) |
| `backend/app/database.py` | lazy, guarded extension load when search enabled |
| `backend/app/repositories/image_embedding_repo.py` | vec0 create/backfill/upsert/delete + vec0 query path with NumPy fallback |
| `backend/app/services/semantic_search_service.py` | backfill vec0 on enable / model change (in `on_settings_change`) |
| `backend/tests/test_semantic_search.py` | vec0-vs-NumPy parity + fallback-when-unavailable |
| `docs/architecture/semantic-search-scale.md` | promote on approval; cross-link `project_semantic_search` |

No Alembic migration. No change to default (search-off) deploys. No change to the ML
sidecar.

## Non-goals / follow-ups

- **Approximate ANN (HNSW/faiss)** — only needed at millions of vectors; heavier, not
  light. sqlite-vec's exact KNN covers the targeted 100k–1M range.
- **Dropping the BLOB column / making vec0 the sole store** — would remove the fallback
  and add a data migration; not worth it while the fallback is the safety net.
