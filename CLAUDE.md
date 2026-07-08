# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ContactSheet

Self-hosted photo delivery app for photographers. AGPL-3.0-or-later licensed.

- Repo: self-hosted Git (Forgejo)
- Deployed at: `<your-domain>` via a reverse proxy (e.g. Nginx Proxy Manager) → the Docker host

## Stack

| Layer | Tech |
|---|---|
| Backend | Python FastAPI + SQLAlchemy + Alembic + Pydantic v2 |
| Frontend | Next.js 16 (App Router) + TypeScript strict + Tailwind + shadcn/ui |
| DB | SQLite at `/data/contactsheet.db` |
| Storage | Local filesystem at `/data/uploads` |
| Auth | JWT (admin cookie) + signed gallery share tokens |
| Deploy | Docker Compose (backend + frontend + nginx) |

## Commands

```bash
# Backend (from backend/)
.venv/bin/uvicorn app.main:app --reload --port 8000   # dev server
.venv/bin/alembic upgrade head                         # apply all migrations
.venv/bin/alembic revision -m "describe_change"        # create a new migration skeleton

# Frontend (from frontend/)
npm run dev       # dev server — proxies /api/* and /uploads/* to localhost:8000
npm run lint      # ESLint (next/core-web-vitals + TypeScript rules)
npm run build     # production build; also runs tsc --noEmit type-check
npm test          # Vitest unit tests (vitest run)

# Tests
.venv/bin/pytest                                       # backend unit suite (from backend/)
.venv/bin/pytest e2e/                                  # Playwright E2E smoke (from repo root)
```

Tests: the backend has a pytest suite under `backend/tests/` covering the
security-critical paths (auth/setup, factory reset, upload & content hardening,
watermark, rate limiting, galleries/images/public/collections, backup/restore,
observability). The frontend uses Vitest — currently unit tests for the sort
logic in `src/lib/`. Prefer adding tests alongside changes to either layer.

End-to-end: `e2e/` holds a Playwright smoke test (Python, `pytest-playwright` in
`backend/requirements-dev.txt`) that drives the core photographer→client loop
through a real browser against live backend + frontend on ephemeral ports — it
boots its own isolated stack, so it won't touch the dev servers. CI runs all
three (backend unit, frontend lint/vitest/build, E2E) via
`.github/workflows/tests.yml`. See `e2e/README.md` +
`docs/architecture/e2e-smoke-tests.md`.

## Running locally

The backend's default paths (`/data/...`) only exist in the Docker container. For local runs,
create `backend/.env` (gitignored) pointing at the repo's `data/` directory:

```
DB_URL=sqlite:////home/<user>/ContactSheet/data/contactsheet.db
UPLOAD_DIR=/home/<user>/ContactSheet/data/uploads
EXPORTS_DIR=/home/<user>/ContactSheet/data/exports
BRANDING_DIR=/home/<user>/ContactSheet/data/branding
WATERMARKS_DIR=/home/<user>/ContactSheet/data/watermarks
```

Without it the backend crashes on startup (`OSError: Read-only file system: '/data'`).

## Architecture rules

- **UUIDv4 PKs** — never expose auto-increment IDs
- **Soft delete** (`deleted_at`) on Gallery and Image
- **Clean layers**: router → service → repository. No business logic in route handlers.
- **REST API first** — every feature must be API-accessible
- Alembic migration required for every schema change; migration files in `backend/alembic/versions/`

## Key backend files

| File | Purpose |
|---|---|
| `app/main.py` | FastAPI app, lifespan startup (secret key, auto-setup, DB cleanup) |
| `app/config.py` | Pydantic settings from env / `.env` |
| `app/runtime_config.py` | Runtime secret key (set during startup, used by JWT) |
| `app/database.py` | SQLAlchemy engine (SQLite WAL + foreign keys); `UTCDateTime` type decorator — all model datetimes round-trip tz-aware UTC so the API serializes a `Z`/offset (SQLite reads `DateTime` back naive otherwise → clients misparse as local time) |
| `app/auth/jwt.py` | Create/decode admin + gallery JWTs |
| `app/auth/dependencies.py` | FastAPI deps: `get_current_admin`, `require_gallery_token` |
| `app/routers/setup.py` | Setup wizard endpoints |
| `app/routers/auth.py` | Login / logout / me |
| `app/routers/galleries.py` | Gallery CRUD, activity, header image, ZIP, votes |
| `app/routers/images.py` | Image upload, update, delete, watermark |
| `app/routers/public.py` | Public gallery access, comments, flags, likes, voting |
| `app/routers/admin_settings.py` | Instance branding settings |
| `app/routers/zip_export.py` | Async ZIP job creation and download |
| `app/models/` | SQLAlchemy models (Gallery, Image, Comment, Vote, Activity, ZipJob, AppSettings) |
| `app/schemas/` | Pydantic request/response schemas — one file per domain, mirroring `models/` |
| `app/repositories/` | All DB queries (one file per model) |
| `app/services/` | Business logic called by routers |
| `app/storage/local.py` | `LocalStorage` — path-traversal-safe filesystem implementation |
| `app/storage/image_processing.py` | Pillow-based resize, thumbnail, watermark compositing |
| `app/tasks/zip_task.py` | `build_zip()` — runs via FastAPI `BackgroundTasks`; updates `ZipJob` status |

ZIP export: `POST /api/galleries/{id}/export/zip` → polls `GET /api/zip-jobs/{id}` → download via `GET /api/zip-jobs/{id}/download`.

Static files (`/uploads`, `/branding`) are mounted at startup via `app.mount(..., StaticFiles(...))`.

## Key frontend files

| File | Purpose |
|---|---|
| `src/app/setup/page.tsx` | First-run setup wizard |
| `src/app/login/page.tsx` | Admin login |
| `src/app/admin/` | Admin dashboard (galleries, settings) |
| `src/app/g/[share_token]/` | Public gallery viewer |
| `src/lib/api.ts` | Typed API client (all backend calls) |
| `src/lib/auth.ts` | Session storage auth flag + gallery tokens |
| `src/lib/types.ts` | Shared TypeScript types |
| `src/lib/ui-icons.ts` | Icon registry (`Icons`): concept → lucide glyph map — import the concept, not the raw glyph |
| `src/lib/ui-tokens.ts` | Overlay opacity/scrim literals (full class strings for Tailwind scan) |
| `src/lib/gallery-fonts.ts` | Font registry — **next/font calls need literal option objects, no spread** |
| `src/store/reviewer.ts` | Zustand persist store for team voting reviewer name |
| `src/store/lightbox.ts` | Zustand store for lightbox open/index/intent state |
| `src/hooks/useImageUpload.ts` | Aggregate upload progress; shared hidden `<input>` |
| `src/hooks/usePinchZoom.ts` | Touch-lightbox pinch/double-tap zoom — suspends the scroll-snap carousel while zoomed |
| `src/hooks/useZoomSlider.ts` | Desktop review-lightbox zoom (slider/wheel/drag-pan) — shares the zoom layer + math with `usePinchZoom` |
| `src/hooks/useGallerySettingsAutosave.ts` | Autosave hook for `GallerySettingsModal` |
| `src/components/admin/AdminDnd.tsx` | `AdminDndProvider` — one DndContext for all reparenting |
| `src/components/admin/GallerySettingsModal.tsx` | Per-gallery settings (tabbed, autosaves) |
| `src/components/chrome/` | Shared primitives: `OverlayPill`, `MediaBadge`, `ConfirmDialog` |
| `src/components/gallery/GalleryToolbar.tsx` | Shared filter/sort/group toolbar (admin + client) |

All backend calls go through `src/lib/api.ts` — a single typed `api` object namespaced by domain. On 401 within `/admin`, it auto-redirects to `/login`.

## Database migrations

Migrations live in `backend/alembic/versions/`. Always create a new file — never edit existing ones.

```
0001 — initial schema
0002 — phase 2 (comments)
0003 — phase 3 (annotations, voting, activities, app_settings, zip_jobs)
0004 — votes unique constraint
0005 — setup wizard columns (setup_complete, admin_username, admin_password_hash, secret_key)
0006 — admin_theme column on app_settings (admin light/dark theme)
0007 — per-gallery presentation & collaboration settings
0008 — share links: public_base_url on app_settings + widened share_token (custom slugs)
0009 — default gallery mode presets: preset_presentation / preset_collaboration JSON on app_settings
0010 — default admin_theme to "light"
0011 — cover_image_id on galleries
0012 — header_focus_x / header_focus_y on galleries
0013 — high_res_previews on app_settings
0014 — admin view settings on app_settings
0015 — public branding footer on app_settings (footer_enabled + footer JSON)
0016 — hide_parent_nav on galleries
0017 — uploaded_by on images (client uploads)
0018 — collections + collection_images
0019 — overview_sort_dir on app_settings
0020 — lightbox_backdrop on app_settings
0021 — overview_corners on app_settings
0022 — masthead branding on app_settings (brand_display / brand_font / brand_color / tagline)
0023 — pinned on galleries
0024 — admin_locale on app_settings
0025 — notifications: app_settings.notifications JSON + galleries.notifications_enabled + notification_outbox table
0026 — admin session revocation: token_version on app_settings ("sign out everywhere")
0027 — annotations: rename galleries.scribbles_enabled → annotations_enabled + comments.anchor JSON
0028 — IPTC display: images.iptc_data JSON + drop galleries.contact_sheet_enabled
0029 — client upload moderation: images.moderation_status + galleries.client_upload_moderation
0030 — gallery cover upload: galleries.cover_image_filename
0031 — activity IP logging: app_settings.activity_ip_logging + activity_ip_retention_days
0032 — accent gradient: app_settings.accent_gradient
0033 — gallery sort defaults: app_settings.gallery_sort / gallery_sort_dir
0034 — per-reviewer likes: image_likes table (unique image_id+reviewer_name)
0035 — configurable source URL: app_settings.source_url (AGPL §13)
0036 — separate lightbox filename toggle: galleries.show_filename_lightbox
0037 — semantic search: image_embeddings table + images.embedding_status + app_settings.semantic_search
0038 — opener title position: galleries.opener_title_position
0039 — star ratings: app_settings.rating_mode + images.rating + image_votes.rating
0040 — backup_jobs table (async full-instance backup builds)
0041 — api_tokens table (personal access tokens for third-party clients)
0042 — showcase hero legibility: galleries.opener_scrim + opener_title_shadow
0043 — client review-mode switch: galleries.client_mode_switch_enabled
0044 — lightbox zoom settings: app_settings.lightbox_zoom_enabled + lightbox_zoom_max
0045 — per-container sub-gallery presets: galleries.subgallery_presets JSON (per-mode look & behaviour templates for new sub-galleries)
```

## Feature invariants

Key non-obvious constraints — full details in `docs/architecture/`.

### Setup wizard & factory reset
- On fresh install (`setup_complete=false`), `/login` and `/admin` redirect to `/setup`.
- Factory reset (`POST /api/admin/settings/reset`) hard-deletes all tables except `app_settings`, clears upload dirs, recreates the `app_settings` singleton, and **rotates the secret key** — invalidating all outstanding tokens.

### Admin auth & sessions
- Stateless JWT in an `httponly samesite=strict` cookie. No server-side session store.
- `app_settings.token_version` is embedded in every token; bumping it ("sign out everywhere") invalidates all previously issued tokens. Change password also bumps it (signs out all other devices) but reissues a fresh cookie for the current browser.
- `POST /api/auth/logout-all` bumps `token_version`; `POST /api/auth/logout` clears only this browser's cookie.

### Gallery settings modal & autosave
- Look & behaviour controls save **immediately** (toggles/selects on change, text/date fields on blur) via `useGallerySettingsAutosave`. No Save button.
- Two things are **not** autosaved — they stay as explicit actions: the `apply_to_subgalleries` cascade footer button, and the gallery password ("Set" button).

### Gallery mode presets & sub-gallery creation
- Top-level galleries merge the mode preset (`_PRESET_FIELDS`) on creation; sub-galleries copy their parent's look & behaviour fields (`_INHERIT_CREATE_FIELDS`) — **unless created with an explicit mode that differs from the parent's**, in which case they fall back to the instance preset for the chosen mode (a Showcase sub-gallery under a Review parent gets the Showcase preset, not the parent's Review look). Explicit request fields always win.
- **`mode` is inherited on create but never cascaded**: `apply_to_subgalleries` propagates look & behaviour to the whole descendant subtree but leaves each sub-gallery's mode untouched — a container can hold mixed Review + Showcase sub-galleries. See `docs/proposals/gallery-per-container-mode-presets.md`.

### Sub-gallery navigation (public)
- A gallery is a **container** when `image_count === 0 && subgalleries.length > 0` — the photo grid is suppressed and children render as cover cards. This gate uses the `image_count` from the public response (which is `only_approved` for moderated galleries).

### Client review-mode switch (Showcase → Review)
- `galleries.client_mode_switch_enabled` (Showcase-only opt-in) lets clients flip the gallery into the Review experience themselves. **Enabling it opens the review write endpoints server-side** — the single gate is `gallery_service.review_active(gallery)` (Review mode *or* switch on); the client toggle is pure view state (`store/review-switch.ts`, sessionStorage, keyed per visible subtree so it survives sub-gallery navigation). With the switch on, the settings modal shows the Review tab for Showcase galleries too. See `docs/architecture/client-review-mode-switch.md`.

### Duplicate-filename upload resolution
- Uploading a filename that already exists (live) in the target gallery can prompt Replace / Keep both / Skip. The admin UI pre-flights via `POST /api/galleries/{id}/images/check-duplicates`, then sends an optional `duplicate_actions` (`filename → replace|keep_both|skip`) form field on upload.
- **A filename absent from the map keeps the legacy silent-append** — the backward-compat contract for PAT clients (Lightroom/Capture One), which never send the field.
- **`replace` overwrites in place**: the existing `Image` row and its **id** are kept (comments/votes/ratings/likes/collection membership/`sort_order` and any `cover_image_id` survive) — this is what makes a gallery **cover follow a re-upload** automatically. Multiple same-name matches → newest is overwritten, older siblings soft-deleted. The **header** is a frozen pixel copy and stays manual. Shared rendition set is `_IMAGE_SUBDIRS` (also used by move/copy). See `docs/architecture/duplicate-filename-upload-resolution.md`.

### Client uploads & moderation
- `image_service.client_upload_images` enforces `client_upload_enabled` (403) and a per-request cap of 50 files.
- When `client_upload_moderation` is on, uploads land with `moderation_status="pending"` and are invisible to the public until approved. `image_repo.get_by_gallery` takes an `only_approved` flag — the public path passes it; the admin path does not.

### Annotations
- An annotation **is a comment** with a nullable `anchor` JSON column. `annotation_count` counts only rows where `anchor` is not null (via `json_extract`). Anchored comments still increment `comment_count`.
- Annotations require comments — the toggle is nested under Comments and disabled without it.

### Lightbox pinch-zoom (touch)
- The mobile carousel stays a **native scroll-snap** container (`touch-action: pan-x`); `usePinchZoom` takes over on a second finger / double-tap and *suspends* the native scroll while zoomed. Its `getRestoreStyle` must mirror the carousel's rendered inline styles — keep them in sync.
- On touch, **single taps route through the hook** (double-tap window) — the photo `onClick` (immersive toggle) is desktop-only.
- `AnnotationLayer` measures with **layout offsets, not `getBoundingClientRect`** — the zoom layer's CSS transform would otherwise double-scale the marks.
- First zoom past ~1.2× swaps the slide `small` → `medium` (preloaded + decoded off-screen; watermark-aware via `variantSrc`). Originals are never fetched for zoom. See `docs/architecture/lightbox-pinch-zoom.md`.

### Lightbox zoom slider (desktop, review contexts)
- The picdrop-style zoom control (right end of the bottom toolbar, same row as the flag/rating actions) appears **only where reviewing happens**: `collabMode || adminGalleryId` — never in a Showcase lightbox. Desktop only; `compact` keeps it mutually exclusive with the pinch hook (both drive the same zoom layer).
- Percent is **relative to fit**. Configurable in Settings → Gallery defaults (`app_settings.lightbox_zoom_enabled` / `lightbox_zoom_max`): on/off + ceiling 200/300/400 % or `"original"` (the photo's 1:1 size, derived per photo). Originals are never fetched — zooming bumps the slide's `sizes` so srcset re-picks the largest preview.
- **Annotating while zoomed works**: zoom persists, wheel/slider stay live, only drag-pan stands down (the pen owns the drag). The note popover counter-scales via `--zoom-scale`. See `docs/architecture/lightbox-zoom-slider.md`.

### Watermarks
- `watermark_service.is_active(ws)` is the single gate — used by the public serializer and the serving proxy. Composited on the fly for thumb/medium, cached to `{variant}-wm/` keyed on a settings hash. Originals and video are never watermarked.

### Colour management (renditions)
- Renditions are always written in **sRGB and tagged** with a small embedded sRGB profile (`image_processing._to_srgb` + `_encode_jpeg`). A wide-gamut source (Adobe RGB, ProPhoto, Display-P3) is colour-converted to sRGB via `ImageCms` before encoding — otherwise its pixels, copied through verbatim into an untagged JPEG, render **desaturated** (browsers assume sRGB). Untagged / already-sRGB sources pass through unchanged; any CMS failure falls back to the raw pixels (never crashes). Originals are untouched.
- **Existing images self-heal on upgrade:** `preview_upgrade` regenerates a rendition when its long edge is wrong **or** it lacks an ICC tag *and* the original is non-sRGB (`original_needs_srgb`) — so pre-fix wide-gamut previews are recoloured on the next restart, idempotently (a re-rendered preview carries the sRGB tag → skipped thereafter).

### Video uploads
- Accepted: `video/mp4`, `video/quicktime`, `video/webm`. Magic-byte validated (ISO-BMFF / EBML). No transcoding.
- Videos skip the Pillow pipeline entirely — `thumb_url`/`medium_url` stay null; `video_url` is always present.

### Drag-and-drop (admin)
- **One `DndContext`** (`AdminDndProvider`) spans the gallery sidebar, nav tree, and page. It owns all gallery reparenting via `api.galleries.move`. Pages register `{ onDragEnd, renderOverlay }` via `useAdminDndRegister` and only handle image moves/reorder.

### Mobile sidebars
- Each sidebar is **one `<aside>` element**, not two — the detail page portals into `#gallery-admin-sidebar-slot`, so a second element would break the portal at the breakpoint. Below `md` it becomes an off-canvas drawer via `max-md:` Tailwind classes.

### Gallery theme scope
- `.gallery-scope` (in `globals.css`) redefines shadcn semantic tokens for the public gallery tone. The `GalleryView` root carries `gallery-scope text-foreground` + conditional `dark` class.
- The pre-hydration script in `app/layout.tsx` **drops `dark` on `/g/…`** so the gallery-scope is the sole tone authority — without this, shadcn `dark:` variants leak into bright galleries.

### i18n
- `next-intl` in "without i18n routing" mode — no locale prefix in URLs.
- `en.json` is the source of truth. Validate catalog changes before committing: `cd frontend && node scripts/validate-i18n.mjs`
- Backend stays English. Client-visible backend errors carry a stable `code` via `CodedHTTPException`; the frontend maps `code → errors.*` in `getErrorCode`.
- Adding a locale: register in `frontend/src/i18n/locales.ts`.

### Notifications
- Delivery is outbox + periodic flush (`notification_service.run_flusher` — in-process async loop, no Celery). `enqueue()` never raises into the request.
- Notification channel secrets are **masked on read** and **merged on write** — never overwrite stored secrets with blanks.

### Real-time (WebSocket)
- Signals carry `{type, gallery_id, image_id?}` only — the client invalidates React Query keys and refetches via REST. No data in the signal.
- Admin WS auth uses the httponly cookie (same-origin handshake). Public WS passes the gallery JWT in `?token=` (browsers can't set WS auth headers).

### Collections
- `collection_service._authorize` enforces **creator-or-admin** on both update and delete. Public reviewer name must match `created_by`; admin bypasses.

### Likes vs team voting
- **Color flags** (`color_flags_enabled`) — one shared flag per photo, anyone overwrites it.
- **Likes** (`likes_enabled`) — per-reviewer, one like per person (`image_likes` table).
- **Team voting** (`enable_team_voting`) — per-reviewer flags in `image_votes`. Depends on Color flags (nested/disabled without it). With team voting on, likes are hidden.

### Rating style: flags, stars, or both (`app_settings.rating_mode`)
- Instance-wide switch — `"flags"` (default) shows color flags, `"stars"` shows 1–5 stars, `"both"` shows the two side by side (independent values, Lightroom-style). `color_flags_enabled` is the generic per-gallery "ratings enabled" gate in every mode (kept its name to avoid churning the cascade/preset field lists).
- **Non-destructive & no conversion.** Stars live in their own columns (`images.rating`, `image_votes.rating`) beside the flag columns; switching modes only changes what's rendered — neither system is converted or cleared. Shared star = `images.rating`; per-reviewer star (team voting) = `image_votes.rating` (one row holds both a reviewer's flag and star). The endpoints are never mode-gated, which is why `"both"` is a pure rendering change (`showsFlags`/`showsStars` in `lib/types.ts`). See `docs/architecture/star-ratings.md` + `docs/architecture/rating-mode-both.md`.
- Public shared rating: `POST /api/public/g/{share_token}/images/{image_id}/rate` (sibling to `/flag`); per-reviewer rides the same `/vote` endpoint (`vote_repo.upsert` writes only the field sent).

### PWA icons
- Icons are rendered by the backend (`app/services/branding_icon.py`) from branding: logo → monogram → default. Served under `/api/branding/` (not the `/branding/` static mount). ETag = branding signature, so a branding change auto-invalidates browsers.

### Semantic search (optional)
- **Embeddings come from a separate `contactsheet-ml` sidecar** (`ml/`), not the backend — the backend has no ML runtime. It's an optional Docker Compose profile (`--profile ml`); the default deploy is unchanged. The backend reaches it via `ML_SERVICE_URL` and calls `app/ml/embedder.py`; images are passed **by path** over the shared `/data` volume, not by bytes.
- **Off by default, twice:** `app_settings.semantic_search.enabled` is false until an admin opts in, and the sidecar is absent unless the operator runs the profile. `embedder.is_configured()` gates everything.
- **Vectors live in SQLite** (`image_embeddings`, one row per image per `model`), L2-normalized float32 BLOBs; ranking is brute-force NumPy cosine in `image_embedding_repo.search`, scoped to a gallery subtree via a join. This is the default and the fallback.
- **Optional sqlite-vec acceleration** (`app/vector_index.py`): when `SEMANTIC_SEARCH_VEC` is on, a derived `vec0` index serves **instance-wide** KNN in C (the 100k+ case); gallery-scoped search stays on NumPy. Off by default → extension never loads. The BLOB table stays source-of-truth; any vec failure falls back to NumPy. See `docs/architecture/semantic-search-scale.md`.
- **Embeddings never bypass access control:** search returns image IDs; hydration goes through the normal `image_service` serializer, so soft-delete/moderation/watermark rules still apply. Soft-deleted images are excluded by the search join.
- **Indexing is background + bounded:** queued on a small pool (`embed_task`, `embed_workers`) from the end of `process_image` (renditions guaranteed to exist) so it never blocks uploads. Videos are `skipped`. Enabling the feature or changing the model (re)queues the library via `semantic_search_service.on_settings_change`.
- **RAW/PSD index from the rendition, not the original:** the sidecar opens files with plain Pillow, which can't read camera RAW (and reads PSD only as a fragile composite). `embed_task._use_original` (via `format_detect.ml_can_read_original`) forces RAW/PSD to embed the `medium` JPEG regardless of `index_originals` — for RAW that's the embedded camera preview, the best readable representation. See `docs/architecture/broad-file-format-support.md`.

### ZIP downloads
- Originals are zipped **`ZIP_STORED`** (no DEFLATE) — they're already-compressed formats, so DEFLATE only burned CPU. Member assembly is shared via `zip_task.collect_members` (de-dups names per folder, skips files missing on disk, `only_approved`-aware).
- The public "download all / selection" streams via `GET /api/public/g/{share_token}/zip/stream` — built on the fly with `zipstream-ng` (sized/STORED → exact `Content-Length`, real browser progress, no temp file, no job/poll). The gallery JWT rides in **`?token=`** (a browser navigation can't set an auth header — see `gallery_id_from_token_value`). The download notification + activity log fire on stream start, skipping the photographer's own (`is_admin`).
- **Public paths pass `only_approved=True`** so pending client uploads never enter a download; the **admin** export (`zip_export.py`) keeps the job/file flow (resume-friendly) and `only_approved=False`. See `docs/architecture/streaming-zip-downloads.md`.

### Backup & restore
- **Full-instance** backup/restore (not per-gallery). Backup is an async job like ZIP export (`backup_jobs` table, `tasks/backup_task.py`) → tar under `exports_dir/backups/`; endpoints under `/api/admin/settings/backup…`. Restore is `POST /api/admin/settings/restore` (web) or `python -m app.restore <archive>` (CLI, blessed for large instances).
- **DB captured via `VACUUM INTO`** (never tar the live WAL `.db`); media copied **before** the DB snapshot so the snapshot never references a missing file. `exports_dir` is never backed up (regenerable). Scopes: `full` (DB + uploads + branding + watermarks) vs `metadata` (no uploads); full can drop renditions.
- **Forward-only restore gate:** `manifest.json` records `alembic_revision`; restore refuses a backup from a *newer* binary (unknown revision) and runs `alembic upgrade head` on older ones. Manifest also carries `db_sha256` (integrity). Restore swaps files, keeps a `.db.bak` for rollback, and reloads the runtime key from restored settings → forces re-login.
- **No encryption / no scheduling yet** — archives are plaintext (they hold the password hash + secret key; the UI warns). Both are documented follow-ups. See `docs/architecture/backup-restore.md`.

### Link previews (Open Graph)
- A pasted share link unfurls with the gallery's **name + cover** via a server `app/g/[share_token]/layout.tsx` (`generateMetadata`) — the gallery `page.tsx` itself stays `"use client"`.
- Metadata comes from a **dedicated, side-effect-free** `GET /api/public/g/{share_token}/meta` — **never** reuse the full `GET /g/{share_token}`, which enqueues a `view` notification + logs activity (a scraper unfurl must not look like a client open). Password-protected galleries expose the name but **not** the cover image.
- The Next *server* calls the backend directly (container-to-container) via `BACKEND_INTERNAL_URL`, not through nginx. `og:image` is absolutized from `app_settings.public_base_url`, falling back to the request host via Next `metadataBase`. See `docs/architecture/gallery-link-previews-open-graph.md`.

### Observability
- `app/observability.py` is wired at the **top of `app/main.py`** (`configure_logging()` + `init_sentry()` run before the app is built). Logging is a `dictConfig`: `LOG_FORMAT=text|json`, `LOG_LEVEL`; uvicorn's access log is silenced in favour of the structured access line from `RequestContextMiddleware` (added **last** → outermost).
- Every request carries a `request_id` (inbound `X-Request-ID` or fresh), bound via a `contextvar` + log filter and echoed back as a header — the correlation key across log lines.
- **Sentry is a no-op unless `SENTRY_DSN` is set.** `send_default_pii=False` + a `before_send` scrubber drop request bodies (photos/passwords) and redact auth headers/cookies. Only unhandled/5xx escalate — `CodedHTTPException`/4xx don't.
- Health is split: `GET /api/health` (liveness + version) and `GET /api/health/ready` (per-component `database`/`migrations`/`ml_sidecar`/`storage`; **503 only if the DB is down**, `migrations: behind` flags an un-migrated image). See `docs/architecture/observability.md`.

### Analytics dashboard
- **Pure read-model over `activities`** — no migration, no new writes. `analytics_repo` (aggregation SQL) → `analytics_service` (zero-fill, totals mapping, hydrate top photos via the normal `image_service` serializer) → `analytics.py` router. Admin-only: `GET /api/galleries/{id}/analytics` (per-gallery) + `GET /api/admin/analytics` (instance rollup).
- **Two data honesty constraints** drive the UI: (1) `viewed` rows exist **only when `activity_ip_logging` is on** → `views_available=false` dims views and shows an enable-prompt rather than a fake zero; (2) `downloaded` is a **gallery-level** ZIP event (no per-image download) → "Top photos" ranks by **per-image engagement** (flags/likes/ratings/votes/comments/annotations), not downloads.
- Frontend: hand-rolled SVG/CSS charts (no chart dep) in `components/admin/analytics/` (`BarTimeseries`, `StatTile`, scaling helper `lib/analytics.ts`). Per-gallery shows in the gallery Insights dialog (Analytics · Activity tabs); instance page at `/admin/analytics`. See `docs/architecture/photographer-analytics.md`.
