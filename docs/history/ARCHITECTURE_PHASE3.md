# ContactSheet — Phase 3 Technical Architecture

> Status: Draft — pending approval before implementation begins
> Scope: Phase 3 (Annotations, Team Voting, Watermarks, Branding, ZIP, Video, Activity Log, Expiration UI)
> Builds on: Phase 1 + 2 (all existing features preserved)

---

## Phase 3 Feature List

| # | Feature | Complexity | Notes |
|---|---------|------------|-------|
| 1 | Gallery Expiration UI | Low | Backend already done (410 Gone); frontend only |
| 2 | Activity Log | Medium | New table; foundation other features write to |
| 3 | Team Voting | Medium | New table, API, frontend reviewer flow |
| 4 | ZIP Download | Medium | Background task, job tracking, admin UI |
| 5 | Watermarks | High | On-the-fly Pillow compositing, new FastAPI route |
| 6 | Branding | Medium | Settings table, admin settings page |
| 7 | Video Support | High | ffmpeg in Docker, poster frame, inline player |
| 8 | Annotations | High | Canvas drawing UI, JSON coordinate storage |
| 9 | Real-time Updates | Optional | WebSocket; lowest priority |

Implementation order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → (9 optional)

---

## Database Schema Changes

### New Tables (single migration: `0003_phase3.py`)

#### `annotations`

```sql
CREATE TABLE annotations (
    id          TEXT PRIMARY KEY,                       -- UUIDv4
    image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    reviewer_name TEXT,                                  -- nullable; null = anonymous
    annotation_data TEXT NOT NULL,                      -- JSON array of strokes/shapes
    created_at  TEXT NOT NULL
);
CREATE INDEX ix_annotations_image_id ON annotations(image_id);
```

`annotation_data` JSON structure (array of shapes):
```json
[
  {"tool": "pen",  "color": "#ff0000", "width": 3, "points": [[x,y],[x,y]...]},
  {"tool": "rect", "color": "#00ff00", "width": 2, "x": 10, "y": 20, "w": 100, "h": 50},
  {"tool": "arrow","color": "#0000ff", "width": 2, "x1": 10, "y1": 10, "x2": 100, "y2": 100},
  {"tool": "text", "color": "#ffffff", "x": 50, "y": 50, "text": "Look here"}
]
```
Coordinates are stored as percentages of image dimensions (0.0–1.0) so annotations scale with display size.

#### `image_votes`

```sql
CREATE TABLE image_votes (
    id          TEXT PRIMARY KEY,                       -- UUIDv4
    image_id    TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    gallery_id  TEXT NOT NULL REFERENCES galleries(id),
    reviewer_name TEXT NOT NULL,
    color_flag  TEXT NOT NULL DEFAULT 'none',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX ix_image_votes_unique ON image_votes(image_id, reviewer_name);
CREATE INDEX ix_image_votes_gallery ON image_votes(gallery_id);
```

Note: The existing `color_flag` on `images` remains for the single-flag Phase 2 collaboration flow. `image_votes` is additive — used only when `enable_team_voting = true`.

#### `activities`

```sql
CREATE TABLE activities (
    id          TEXT PRIMARY KEY,                       -- UUIDv4
    gallery_id  TEXT NOT NULL REFERENCES galleries(id),
    image_id    TEXT REFERENCES images(id),             -- nullable (gallery-level events)
    action      TEXT NOT NULL,                          -- see enum below
    author      TEXT NOT NULL,                          -- "admin" or reviewer name
    meta        TEXT,                                   -- JSON: extra context
    created_at  TEXT NOT NULL
);
CREATE INDEX ix_activities_gallery ON activities(gallery_id, created_at);
```

`action` values: `uploaded`, `flagged`, `liked`, `commented`, `annotated`, `voted`, `zip_created`

#### `app_settings`

```sql
CREATE TABLE app_settings (
    id              INTEGER PRIMARY KEY DEFAULT 1,      -- singleton row
    instance_name   TEXT NOT NULL DEFAULT 'ContactSheet',
    accent_color    TEXT NOT NULL DEFAULT '#3b82f6',    -- CSS hex color
    logo_filename   TEXT                                -- filename in /data/branding/
);
```

#### `zip_jobs`

```sql
CREATE TABLE zip_jobs (
    id              TEXT PRIMARY KEY,                   -- UUIDv4
    gallery_id      TEXT NOT NULL REFERENCES galleries(id),
    status          TEXT NOT NULL DEFAULT 'pending',    -- pending|ready|error
    filter_type     TEXT NOT NULL DEFAULT 'all',        -- all|flagged|green|red|yellow|blue
    image_count     INTEGER,
    file_path       TEXT,                               -- /data/exports/{gallery_id}/{id}.zip
    error_message   TEXT,
    created_at      TEXT NOT NULL,
    ready_at        TEXT
);
CREATE INDEX ix_zip_jobs_gallery ON zip_jobs(gallery_id);
```

### Column Additions to Existing Tables

```sql
-- galleries: team voting + branding fields
ALTER TABLE galleries ADD COLUMN enable_team_voting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE galleries ADD COLUMN headline TEXT;
ALTER TABLE galleries ADD COLUMN header_image_filename TEXT;

-- images: video support
ALTER TABLE images ADD COLUMN is_video INTEGER NOT NULL DEFAULT 0;
ALTER TABLE images ADD COLUMN video_poster_filename TEXT;  -- {uuid}.jpg in /poster/ subdir
```

---

## New Models (Python)

### `models/annotation.py`

```python
class Annotation(Base):
    __tablename__ = "annotations"
    id: Mapped[str]
    image_id: Mapped[str]
    reviewer_name: Mapped[str | None]
    annotation_data: Mapped[str]   # JSON text
    created_at: Mapped[datetime]
```

### `models/vote.py`

```python
class ImageVote(Base):
    __tablename__ = "image_votes"
    id: Mapped[str]
    image_id: Mapped[str]
    gallery_id: Mapped[str]
    reviewer_name: Mapped[str]
    color_flag: Mapped[str]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
```

### `models/activity.py`

```python
class Activity(Base):
    __tablename__ = "activities"
    id: Mapped[str]
    gallery_id: Mapped[str]
    image_id: Mapped[str | None]
    action: Mapped[str]
    author: Mapped[str]
    meta: Mapped[str | None]   # JSON text
    created_at: Mapped[datetime]
```

### `models/app_settings.py`

```python
class AppSettings(Base):
    __tablename__ = "app_settings"
    id: Mapped[int]   # always 1
    instance_name: Mapped[str]
    accent_color: Mapped[str]
    logo_filename: Mapped[str | None]
```

### `models/zip_job.py`

```python
class ZipJob(Base):
    __tablename__ = "zip_jobs"
    id: Mapped[str]
    gallery_id: Mapped[str]
    status: Mapped[str]
    filter_type: Mapped[str]
    image_count: Mapped[int | None]
    file_path: Mapped[str | None]
    error_message: Mapped[str | None]
    created_at: Mapped[datetime]
    ready_at: Mapped[datetime | None]
```

---

## API Endpoint Design

### Feature 1: Gallery Expiration (frontend only — no new API)

The backend already returns `HTTP 410 Gone` from `GET /api/public/g/{token}` when expired.
Frontend needs to catch the 410 and render a dedicated "This gallery has expired" page.

---

### Feature 2: Activity Log

#### Admin
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/galleries/{id}/activity` | Paginated activity feed |

Query params: `?page=1&limit=20`

Response:
```json
{
  "items": [
    {
      "id": "uuid",
      "action": "commented",
      "author": "Jane",
      "image_id": "uuid",
      "meta": {"comment_preview": "Love this shot"},
      "created_at": "2026-06-11T12:00:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

Activities are logged internally by services (not a client-facing write endpoint).

---

### Feature 3: Team Voting

Gallery update via existing `PATCH /api/galleries/{id}` — add `enable_team_voting` field.

#### Public
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/public/g/{token}/votes?reviewer={name}` | Get reviewer's current votes |
| `PUT` | `/api/public/g/{token}/images/{image_id}/vote` | Set/update vote |

**PUT vote** body: `{"reviewer_name": "Jane", "color_flag": "green"}`
Response: `{"id": "uuid", "image_id": "uuid", "reviewer_name": "Jane", "color_flag": "green"}`

Upsert: if a vote from this reviewer on this image already exists → update it.
Gallery must have `enable_team_voting = true`, else `400 Bad Request`.

#### Admin
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/galleries/{id}/votes/summary` | Vote aggregation per image |

Response:
```json
{
  "reviewers": ["Jane", "Bob"],
  "images": {
    "image-uuid": {
      "Jane": "green",
      "Bob": "red",
      "totals": {"green": 1, "red": 1, "none": 0, "yellow": 0, "blue": 0}
    }
  }
}
```

---

### Feature 4: ZIP Download

#### Admin
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/galleries/{id}/export/zip` | Queue ZIP job |
| `GET` | `/api/galleries/{id}/export/zip/{job_id}` | Poll job status |
| `GET` | `/api/galleries/{id}/export/zip/{job_id}/download` | Stream ZIP file |
| `DELETE` | `/api/galleries/{id}/export/zip/{job_id}` | Cancel/delete job |

**POST** body: `{"filter_type": "all" | "flagged" | "green" | "red" | "yellow" | "blue"}`
Response: `{"job_id": "uuid", "status": "pending"}`

**GET status** response: 
```json
{"job_id": "uuid", "status": "ready", "image_count": 42, "download_url": "/api/galleries/{id}/export/zip/{job_id}/download"}
```

ZIP is generated by a BackgroundTask. Files stored at `/data/exports/{gallery_id}/{job_id}.zip`.
The download endpoint serves the file as `application/zip` with `Content-Disposition: attachment`.

---

### Feature 5: Watermarks

Gallery settings (via existing `PATCH /api/galleries/{id}`) — `watermark_settings` JSON field:
```json
{
  "enabled": true,
  "filename": "wm-uuid.png",
  "position": "bottom-right",   // "center" | "bottom-right" | "bottom-left" | "bottom-center"
  "opacity": 50,                // 0-100
  "size": "medium"              // "small" (15%) | "medium" (25%) | "large" (40%) of image width
}
```

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/galleries/{id}/watermark` | Upload watermark PNG |
| `DELETE` | `/api/galleries/{id}/watermark` | Remove watermark image |
| `GET` | `/api/public/g/{token}/images/{image_id}/medium` | Watermarked medium image |

**Watermark upload**: multipart, single PNG file. Stored at `/data/watermarks/{gallery_id}/{uuid}.png`. Returns `{filename: "wm-uuid.png"}`.

**Watermarked medium endpoint**: FastAPI serves the image (bypassing nginx for watermarked requests). Applies Pillow composite on the fly; result is NOT cached on disk.

When `watermark_settings.enabled = false` (or no settings), clients still use the direct nginx URL `/uploads/{gallery_id}/medium/{filename}`. When enabled, the frontend switches to `/api/public/g/{token}/images/{image_id}/medium`.

`GalleryPublicResponse` gains: `watermark_enabled: bool` (computed from settings).

nginx config: add `/data/watermarks` volume mount (read-only).

---

### Feature 6: Branding

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/settings` | Get instance settings |
| `PATCH` | `/api/admin/settings` | Update `instance_name`, `accent_color` |
| `POST` | `/api/admin/settings/logo` | Upload logo PNG/SVG |
| `DELETE` | `/api/admin/settings/logo` | Remove logo |

**PATCH** body: `{"instance_name": "My Studio", "accent_color": "#e11d48"}`
Response: `AppSettingsResponse`

Logo stored at `/data/branding/{uuid}.{ext}`. Served by nginx via `/branding/*` alias.

Per-gallery via existing `PATCH /api/galleries/{id}` — new fields: `headline: str | None`, header image via:
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/galleries/{id}/header-image` | Upload gallery header image |
| `DELETE` | `/api/galleries/{id}/header-image` | Remove header image |

Header images stored at `/data/branding/gallery-headers/{gallery_id}/{uuid}.jpg`. Served by nginx.

nginx config: add `/data/branding` volume mount + `/branding/` location alias.

---

### Feature 7: Video Support

Extend upload to accept `video/mp4` and `video/quicktime` (MOV).

No new API endpoints — same upload flow as images. Processing handles videos differently:

**Video processing pipeline** (BackgroundTask):
1. Detect `is_video = true` from MIME type
2. Run ffmpeg: `ffmpeg -i {input} -ss 00:00:01 -vframes 1 {output_poster.jpg}`
3. Store poster at `/data/uploads/{gallery_id}/poster/{uuid}.jpg`
4. Update image record: `is_video=True`, `video_poster_filename="{uuid}.jpg"`, dimensions from ffmpeg probe
5. Generate thumb from poster (Pillow, same as images)
6. No medium variant for video (stream original)

`ImageResponse` gains: `is_video: bool`, `video_url: str | None` (direct nginx URL for the video file).

nginx config: add video MIME types, `Content-Range` headers for video streaming.

Docker: add `ffmpeg` to the backend Dockerfile.

---

### Feature 8: Annotations

#### Public
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/public/g/{token}/images/{image_id}/annotations` | List annotations |
| `POST` | `/api/public/g/{token}/images/{image_id}/annotations` | Save annotation |

**POST** body: `{"reviewer_name": "Jane" | null, "annotation_data": [...]}`
Gallery must be in collaboration mode, else `400`.
Overwrites previous annotation from same `reviewer_name` on this image (upsert by reviewer_name+image_id).

#### Admin
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/images/{id}/annotations` | All annotations for image |
| `DELETE` | `/api/annotations/{id}` | Delete annotation |

---

### Feature 9: Real-time Updates (Optional)

| Method | Path | Description |
|--------|------|-------------|
| `WS` | `/api/ws/g/{share_token}` | Client subscribes to gallery events |
| `WS` | `/api/ws/admin/galleries/{id}` | Admin subscribes (requires Bearer token in first message) |

Events broadcast on: flag, like, comment, annotation, vote, upload-complete.

Event format:
```json
{"event": "flag", "image_id": "uuid", "color_flag": "green", "author": "Jane", "ts": "..."}
```

Implementation: FastAPI WebSocket + in-memory `asyncio.Queue` per gallery (no Redis needed for single-instance self-hosted). Falls back gracefully when disabled.

---

## New Files (Backend)

```
backend/app/
├── models/
│   ├── annotation.py          # NEW
│   ├── vote.py                # NEW
│   ├── activity.py            # NEW
│   ├── app_settings.py        # NEW
│   └── zip_job.py             # NEW
│
├── repositories/
│   ├── annotation_repo.py     # NEW
│   ├── vote_repo.py           # NEW
│   ├── activity_repo.py       # NEW
│   ├── settings_repo.py       # NEW
│   └── zip_job_repo.py        # NEW
│
├── services/
│   ├── annotation_service.py  # NEW
│   ├── vote_service.py        # NEW
│   ├── activity_service.py    # NEW (also called by other services)
│   ├── settings_service.py    # NEW
│   ├── zip_service.py         # NEW
│   └── video_service.py       # NEW (video processing)
│
├── routers/
│   ├── admin_settings.py      # NEW (/api/admin/settings)
│   ├── votes.py               # NEW (/api/galleries/{id}/votes)
│   ├── zip_export.py          # NEW (/api/galleries/{id}/export/zip)
│   └── public.py              # EXTENDED (annotations, votes, watermarked image)
│
└── tasks/
    ├── image_processing.py    # EXTENDED (video poster via ffmpeg)
    └── zip_task.py            # NEW
```

---

## New Files (Frontend)

```
frontend/src/
├── app/
│   ├── admin/
│   │   ├── settings/
│   │   │   └── page.tsx           # NEW: branding + instance settings
│   │   └── galleries/[id]/
│   │       ├── page.tsx           # EXTENDED: team voting summary, ZIP download, activity feed
│   │       └── activity/
│   │           └── page.tsx       # NEW: full activity log (or modal)
│   └── g/[share_token]/
│       └── page.tsx               # EXTENDED: expiration UI, team voting prompt
│
├── components/
│   ├── admin/
│   │   ├── ActivityFeed.tsx        # NEW
│   │   ├── VotingSummary.tsx       # NEW
│   │   ├── ZipExport.tsx           # NEW
│   │   └── WatermarkUpload.tsx     # NEW
│   └── gallery/
│       ├── AnnotationCanvas.tsx    # NEW (canvas drawing overlay)
│       ├── ReviewerNamePrompt.tsx  # NEW (team voting entry)
│       ├── GalleryExpired.tsx      # NEW
│       └── VideoPlayer.tsx         # NEW
│
└── store/
    ├── reviewer.ts                 # NEW: Zustand — reviewer name (persisted sessionStorage)
    └── annotations.ts              # NEW: Zustand — local annotation state before save
```

---

## Storage Layout Changes

```
/data/
├── contactsheet.db
├── uploads/
│   └── {gallery_id}/
│       ├── original/
│       ├── thumb/
│       ├── medium/
│       └── poster/            # NEW: video poster frames as .jpg
├── exports/                   # NEW: ZIP files
│   └── {gallery_id}/
│       └── {job_id}.zip
├── watermarks/                # NEW: gallery watermark PNGs
│   └── {gallery_id}/
│       └── {uuid}.png
└── branding/                  # NEW: logo + gallery header images
    ├── {uuid}.{ext}           # instance logo
    └── gallery-headers/
        └── {gallery_id}/
            └── {uuid}.jpg
```

nginx volumes: add `./data/exports`, `./data/watermarks`, `./data/branding` mounts.
nginx locations: add `/branding/` and `/exports/` aliases (exports: admin-only, need proxy-through FastAPI for auth check rather than direct nginx serve).

---

## Docker Changes

### Dockerfile (backend stage)

Add ffmpeg:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

### docker-compose.yml

Add new volumes:
```yaml
volumes:
  - ./data:/data
  # exports and branding are subdirs of /data, no extra mounts needed
```

nginx: add read-only alias for `/branding/`.

---

## Config Changes

New env vars (all optional):
```
MAX_VIDEO_SIZE      int     -- max video upload size bytes, default 2GB
EXPORTS_DIR         str     -- default /data/exports
WATERMARKS_DIR      str     -- default /data/watermarks
BRANDING_DIR        str     -- default /data/branding
ZIP_TTL_HOURS       int     -- how long to keep ZIPs before cleanup, default 24
```

---

## Pydantic Schema Additions

### `GalleryUpdate` (extended)
New optional fields: `enable_team_voting`, `headline`, `watermark_settings`

### `GalleryPublicResponse` (extended)
New fields: `watermark_enabled: bool`, `enable_team_voting: bool`, `headline: str | None`, `header_image_url: str | None`

### `GalleryResponse` (extended)
New fields: `enable_team_voting: bool`, `headline: str | None`, `header_image_url: str | None`, `watermark_settings: dict | None`

### `ImageResponse` (extended)
New fields: `is_video: bool`, `video_url: str | None`, `annotation_count: int`

### New schemas
- `AnnotationCreate`, `AnnotationResponse`
- `VoteCreate`, `VoteResponse`, `VoteSummaryResponse`
- `ActivityResponse`, `ActivityPage`
- `ZipJobCreate`, `ZipJobResponse`
- `AppSettingsResponse`, `AppSettingsUpdate`

---

## Implementation Roadmap (One Feature at a Time)

| # | Feature | Backend | Frontend | Migration |
|---|---------|---------|----------|-----------|
| 1 | Gallery Expiration UI | — (done) | `GalleryExpired.tsx` + catch 410 | — |
| 2 | Activity Log | models + repo + service + router | `ActivityFeed.tsx` in admin | `0003_phase3.py` (all tables at once) |
| 3 | Team Voting | models + repo + service + public router + admin router | `ReviewerNamePrompt`, `VotingSummary`, flag UI per reviewer | same migration |
| 4 | ZIP Download | `zip_task.py` + service + router | `ZipExport.tsx` in gallery detail | same migration |
| 5 | Watermarks | watermark upload service + `/medium` endpoint | `WatermarkUpload`, switch image src when enabled | same migration |
| 6 | Branding | `app_settings` service + router | settings page + logo header | same migration |
| 7 | Video Support | ffmpeg Dockerfile + extend processing task | `VideoPlayer.tsx` + poster in grid | same migration |
| 8 | Annotations | annotation service + public/admin router | `AnnotationCanvas.tsx` in lightbox | same migration |
| 9 | Real-time (opt.) | WebSocket router | ws hook + live update stores | — |

All 8 new tables/columns go into one migration `0003_phase3.py` upfront (step 2), since they're all additive and non-breaking.

---

## Open Questions

1. **Annotation canvas library**: Hand-rolled HTML5 Canvas API (no deps) vs. Konva.js vs. Fabric.js? Hand-rolled is ~200 LOC for pen+rect+arrow+text and adds no bundle weight; recommend this.

2. **ZIP cleanup**: ZIP files at `/data/exports` will accumulate. Run cleanup as a startup check (delete ZIPs older than `ZIP_TTL_HOURS`) or add a cron endpoint? Recommend: cleanup on startup + on new ZIP job creation.

3. **Watermarked image caching**: The on-the-fly watermark route can be expensive. Add `Cache-Control: max-age=3600` response header — browser caches it per image. No server-side cache needed for self-hosted low-traffic use.

4. **Video upload size limit**: Videos can be several GB. Current `client_max_body_size 250M` in nginx needs to be raised. Recommend `2G` or make it configurable via env var in nginx template.

5. **Team voting reviewer identity**: Reviewer name is stored in `sessionStorage`. If client reopens browser, they lose their session identity. Is this acceptable, or should we persist in `localStorage`? Recommend `localStorage` with `sessionStorage` fallback.
