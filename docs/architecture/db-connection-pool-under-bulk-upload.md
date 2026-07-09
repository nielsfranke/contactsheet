# DB connection pool exhaustion under bulk upload

## Symptom

A photographer bulk-uploaded ~50 photos each into two sub-galleries via a third-party
API client (Cullimingo, same upload path as the Lightroom / Capture One plugins). The
**admin** view showed the photos, but the **client (public)** view served broken
thumbnails and full-size images for several minutes. After the burst subsided,
everything loaded correctly with no further intervention.

Backend logs for the window (≈21:25–21:32 UTC) show **174** occurrences of:

```
sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached,
connection timed out, timeout 30.00
```

The failing requests span **both** surfaces — the admin polling endpoints and the
public gallery/image endpoints:

```
44× GET /api/galleries/…/images      16× GET /api/public/g/…            (client view)
40× GET /api/galleries               15× GET /api/public/g/…/images
21× GET /api/admin/settings          13× GET /api/public/g/…/thumb
```

Public image requests ran into the 30 s pool timeout → 500 → the browser rendered
broken images. This is a **ContactSheet** scalability bug, not a fault of the upload
client — a bulk upload over the API is a supported, first-class path.

## Root cause

`app/database.py` builds the engine with **no pool sizing**:

```python
engine = create_engine(settings.db_url, connect_args={"check_same_thread": False})
```

SQLAlchemy's default `QueuePool` is **`pool_size=5, max_overflow=10` → 15 connections
max, `pool_timeout=30`** — exactly the numbers in the error. Fifteen concurrent
checked-out connections is easy to hit during a bulk upload, from three compounding
sources:

1. **WebSocket-driven admin refetch storm (dominant).** Every uploaded image emits a
   WS signal; the admin client invalidates React Query keys and refetches
   `/galleries` + `/galleries/{id}/images` + `/admin/settings`. ~100 uploads in a few
   seconds → a burst of read requests, each checking out a pool connection. This
   matches the top failing endpoints above.

2. **SQLite single-writer serialization.** Renditions finish on the `image_workers`
   pool and each writes its row. SQLite (even WAL) allows exactly one writer at a
   time; `busy_timeout=5000` makes the others *wait up to 5 s holding their pool
   connection*. Under the burst, writers queue behind each other while occupying
   pool slots.

3. **Embedding workers hold a connection across a network call.** `embed_task.embed_one`
   opens `db = SessionLocal()` (line 60), then calls the ML sidecar over HTTP
   (`embedder.embed_image`, line 84) **while the session is still checked out**, and
   only closes it at line 96. Each of the `embed_workers` (default 2) pins a pool
   connection for the full duration of a network round-trip it doesn't need the DB
   for. Semantic search is what turned an ordinary bulk upload into a pool storm.

Once the pool is saturated, request #16+ waits `pool_timeout=30 s` and then throws —
which is why *both* the admin UI and the public gallery degraded together, and why it
self-healed once the upload/embed backlog drained.

## Fix

Three changes, smallest-blast-radius first.

### 1. Size the pool for a bulk-upload burst (`app/database.py`)

```python
engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False},
    pool_size=settings.db_pool_size,          # default 20
    max_overflow=settings.db_max_overflow,    # default 40  → 60 max
    pool_timeout=settings.db_pool_timeout,    # default 30
    pool_pre_ping=True,
)
```

Add the three knobs to `app/config.py` (env-overridable: `DB_POOL_SIZE` etc.) so an
operator on a small box can tune down and a large instance up. WAL already allows
unlimited concurrent **readers**, so a larger pool directly relieves the read-heavy
refetch storm; writes still serialize on SQLite's single writer, but readers no longer
queue 30 s behind them.

### 2. Don't hold a pool connection across the ML HTTP call (`app/tasks/embed_task.py`)

Restructure `embed_one` into read → (close session) → embed over HTTP → (reopen) write:

- Session A: load the image row + active config, decide the source path, then **close**.
- No session held: call `embedder.embed_image(path, model)` (the slow network op).
- Session B: `upsert` the vector + `set_embedding_status`, then close.

This removes embeddings as a pool-starvation source entirely and is the real fix for
factor 3; the pool bump (1) is the mitigation for factors 1–2.

### 3. (Optional, follow-up) Coalesce the WS refetch storm

Debounce/animation-frame-coalesce the admin React Query invalidations, or batch the
per-image upload WS signals server-side, so 100 uploads don't fan out into 100
independent refetches. Tracked as a follow-up — (1)+(2) already resolve the outage;
this reduces load headroom. Not required for the fix.

## Non-goals / notes

- **Nothing to change in the upload client.** Cullimingo / the plugins upload originals
  over the API exactly as designed; the server must absorb the burst.
- **No migration.** All changes are engine/runtime config and task structure; no schema
  change.

## Deployment impact

- **Backend image only** — a normal `docker compose pull && up -d` on the deskmini
  (`kunden.nielsfranke.com`) delivers it. No host `nginx.conf` change, no NPM change,
  no migration.
- New optional env vars (`DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT`) have safe
  defaults; the current deploy needs no compose edit to benefit.
