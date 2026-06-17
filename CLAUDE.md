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
```

No tests exist yet for either layer.

## Running locally

The backend's default paths (`/data/...`) only exist in the Docker container. For local runs,
create `backend/.env` (gitignored) pointing at the repo's `data/` directory — adjust the
absolute path to your checkout:

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

## First-run setup wizard

On a fresh install (no `ADMIN_PASSWORD` env var), the backend starts with `setup_complete=false`. Any visit to `/login` or `/admin` redirects to `/setup`, where the admin picks their username and password. After submit, setup is locked and normal login applies.

Existing deployments that pass `ADMIN_PASSWORD` via env auto-complete setup on first boot (backwards compatible).

`SECRET_KEY` is also optional — auto-generated and persisted to the DB if not supplied.

Key files:
- `backend/app/routers/setup.py` — `GET /api/setup/status`, `POST /api/setup`
- `backend/app/runtime_config.py` — lazy secret key holder, set during lifespan startup
- `frontend/src/app/setup/page.tsx` — wizard UI
- `AppSettings.setup_complete / admin_username / admin_password_hash / secret_key` columns (migration `0005`)

## Factory reset

Architecture doc: `docs/architecture/factory-reset.md` (implemented 2026-06-16). A guarded admin
action that returns the instance to a fresh-install state → next visit lands on `/setup`. No
migration (no schema change).

- **Endpoint** — `POST /api/admin/settings/reset` (`ResetRequest{password}`, admin-only, rate-limited
  `3/minute`) → `reset_service.factory_reset(password, db)`. **Password re-verified before anything is
  deleted** (coded `invalid_current_password`).
- **Wipe** — (1) hard-deletes every table **except `app_settings`**, data-driven via
  `reversed(Base.metadata.sorted_tables)` (children-first, FK-safe; soft-delete is bypassed — this is
  a real purge, and new tables are covered automatically); (2) clears the *contents* of `upload_dir /
  exports_dir / branding_dir / watermarks_dir` (dir roots kept so static mounts stay valid; stays
  within each configured root); (3) deletes + recreates the `app_settings` singleton (fresh defaults:
  `setup_complete=False`, admin creds `NULL`), then **rotates the secret key** and updates
  `runtime_config` — invalidating every outstanding token so the acting admin is logged straight out.
- **Frontend** — `components/admin/ResetDangerZone.tsx` (a "Danger zone" card at the bottom of
  `/admin/settings/general`): a destructive modal requiring typing `RESET` **and** the password before
  the button enables; on success clears the `sessionStorage` auth flag and hard-redirects to `/setup`.
  `api.adminSettings.reset(password)`; i18n under `settings.general.danger.*`.

## Admin auth & sessions

Stateless JWT in an `httponly` + `samesite=strict` cookie (`access_token`), signed with the runtime
secret key. No server-side session store.

- **Login** — `POST /api/auth/login` (`auth_service.login` → `create_admin_token`). `LoginRequest.remember`
  drives session length: unchecked → JWT exp `access_token_ttl` (24h) **and a session cookie** (no
  `max_age`, clears on browser close); checked ("Remember me") → exp + cookie `max_age` of
  `remember_token_ttl` (30d). Both TTLs are env-overridable (`ACCESS_TOKEN_TTL` / `REMEMBER_TOKEN_TTL`).
  Login page checkbox → `api.auth.login(u, p, remember)`.
- **Logout** — `POST /api/auth/logout` drops the local cookie only (this browser). `POST
  /api/auth/logout-all` ("sign out everywhere") **also** bumps `app_settings.token_version` (migration
  `0026`), which every admin token carries (`jwt.py` `"ver"`) and every request checks
  (`dependencies.py`) — so all previously issued tokens (other devices, leaked cookies) are rejected.
  The admin sidebar shows one **Sign out** button → a dialog offering "This device" vs "All devices".
- **Change password** — `POST /api/auth/change-password` (`ChangePasswordRequest{current_password,
  new_password}`, `auth_service.change_password`). Verifies the current password (coded errors
  `invalid_current_password` / `password_unchanged`), stores a fresh bcrypt hash, **bumps
  `token_version`** (signs out all other devices), and **reissues this browser's cookie** with a new
  token (a session cookie — no `max_age`) so the current session stays valid. UI:
  `/admin/settings/account` (Workspace nav group). No migration (`admin_password_hash` /
  `token_version` already exist).
- **Change username** — `POST /api/auth/change-username` (`ChangeUsernameRequest{new_username,
  current_password}`, `auth_service.change_username`). Password-confirmed; trims + rejects
  empty/unchanged (`username_unchanged`). The username **isn't** in the JWT, so no session is
  touched (no token bump, no cookie reissue). `GET /api/auth/me` now returns the real
  `admin_username` (was hardcoded `"admin"`). Same `/admin/settings/account` page (Username
  section above Password).
- Key files: `backend/app/auth/jwt.py`, `app/auth/dependencies.py`, `app/routers/auth.py`,
  `app/services/auth_service.py`, `frontend/src/app/login/page.tsx`, `frontend/src/app/admin/layout.tsx`.

## Key backend files

| File | Purpose |
|---|---|
| `app/main.py` | FastAPI app, lifespan startup (secret key, auto-setup, DB cleanup) |
| `app/config.py` | Pydantic settings from env / `.env` |
| `app/runtime_config.py` | Runtime secret key (set during startup, used by JWT) |
| `app/database.py` | SQLAlchemy engine (SQLite WAL + foreign keys) |
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
| `app/storage/base.py` | `StorageProvider` ABC (`save`, `delete`, `url`) |
| `app/storage/local.py` | `LocalStorage` — path-traversal-safe filesystem implementation |
| `app/storage/image_processing.py` | Pillow-based resize, thumbnail, watermark compositing |
| `app/tasks/zip_task.py` | `build_zip()` — runs via FastAPI `BackgroundTasks`; updates `ZipJob` status |

ZIP export flow: `POST /api/galleries/{id}/export/zip` enqueues `build_zip` as a background task
and returns a `ZipJob` UUID; the frontend polls `GET /api/zip-jobs/{id}` until `status == "done"`,
then triggers a download via `GET /api/zip-jobs/{id}/download`.

Static files (`/uploads`, `/branding`) are mounted at startup in `_lifespan` via
`app.mount(..., StaticFiles(...))`, so they're served directly by uvicorn in dev.

## Key frontend files

| File | Purpose |
|---|---|
| `src/app/setup/page.tsx` | First-run setup wizard |
| `src/app/login/page.tsx` | Admin login (redirects to /setup if not yet complete) |
| `src/app/admin/` | Admin dashboard (galleries, settings) |
| `src/app/g/[share_token]/` | Public gallery viewer |
| `src/lib/api.ts` | Typed API client (all backend calls) |
| `src/lib/auth.ts` | Session storage auth flag + gallery tokens |
| `src/lib/types.ts` | Shared TypeScript types |
| `src/store/reviewer.ts` | Zustand persist store for team voting reviewer name |
| `src/store/lightbox.ts` | Zustand store for lightbox open/index state |
| `src/hooks/useImageUpload.ts` | Aggregate upload progress; shared hidden `<input>` |
| `src/components/admin/` | Admin UI components |
| `src/components/gallery/` | Public gallery components (PhotoGrid, Lightbox, etc.) |
| `src/components/gallery/GalleryToolbar.tsx` | Shared view-controls toolbar (filter/sort/group) for **both** the admin in-gallery view and the client gallery — semantic tokens; `GalleryViewToolbar` is now a thin admin wrapper |

All backend calls go through `src/lib/api.ts` — a single typed `api` object namespaced by
domain (`api.galleries.*`, `api.images.*`, `api.public.*`, etc.). On 401 within `/admin`,
it auto-redirects to `/login` and clears the auth flag in `sessionStorage`.

## Database migrations

Migrations live in `backend/alembic/versions/`. Always create a new file — never edit existing ones.

```
0001 — initial schema
0002 — phase 2 (comments)
0003 — phase 3 (annotations, voting, activities, app_settings, zip_jobs)
0004 — votes unique constraint
0005 — setup wizard columns (setup_complete, admin_username, admin_password_hash, secret_key)
0006 — admin_theme column on app_settings (admin light/dark theme)
0007 — per-gallery presentation & collaboration settings (Phase B gallery settings)
0008 — share links: public_base_url on app_settings + widened share_token (custom slugs)
0009 — default gallery mode presets: preset_presentation / preset_collaboration JSON on app_settings
0010 — default admin_theme to "light" (server default; existing rows untouched)
0011 — cover_image_id on galleries
0012 — header_focus_x / header_focus_y on galleries
0013 — high_res_previews on app_settings (instance-wide preview quality toggle)
0014 — admin view settings on app_settings (admin grid mirror/custom override + gallery overview look/sort)
0015 — public branding footer on app_settings (footer_enabled + footer JSON)
0016 — hide_parent_nav on galleries (standalone access: clients can't navigate to the parent/ancestors)
0017 — uploaded_by on images (client uploads: reviewer name of a public uploader; null for admin)
0018 — collections + collection_images (named saved image selections, admin + client review)
0019 — overview_sort_dir on app_settings (gallery overview / left-tree sort direction)
0020 — lightbox_backdrop on app_settings (instance-wide public lightbox backdrop tone)
0021 — overview_corners on app_settings (gallery overview card corner rounding)
0022 — masthead branding on app_settings (brand_display / brand_font / brand_color / tagline)
0023 — pinned on galleries (admin favorite shelf)
0024 — admin_locale on app_settings (admin UI language)
0025 — notifications: app_settings.notifications JSON + galleries.notifications_enabled + notification_outbox table
0026 — admin session revocation: token_version on app_settings ("sign out everywhere")
0027 — annotations: rename galleries.scribbles_enabled → annotations_enabled + comments.anchor JSON
0028 — IPTC display: images.iptc_data JSON + drop galleries.contact_sheet_enabled (contact sheet scrapped)
0029 — client upload moderation: images.moderation_status + galleries.client_upload_moderation
0030 — gallery cover upload: galleries.cover_image_filename (custom card image, independent of photos)
0031 — activity IP logging: app_settings.activity_ip_logging + activity_ip_retention_days
0032 — accent gradient: app_settings.accent_gradient (gradient primary buttons, derived from accent_color)
0033 — gallery sort defaults: app_settings.gallery_sort / gallery_sort_dir (sticky in-gallery + client default) + overview_sort_dir default → "desc" (newest first)
0034 — per-reviewer likes: image_likes table (unique image_id+reviewer_name) for one-like-per-person toggle
0035 — configurable source URL: app_settings.source_url (AGPL §13 — admin can point the source link at a fork)
```

## Phase status

- **Phase 1** ✅ Gallery tree, upload, image processing, admin dashboard, Docker
- **Phase 2** ✅ Collaboration mode (flags, likes, comments), export
- **Phase 3** ✅ Features 1–9 done
  - ✅ Gallery expiration UI
  - ✅ Activity log
  - ✅ Team voting
  - ✅ ZIP download
  - ✅ Watermarks
  - ✅ Branding (instance name, accent color, logo, gallery header image)
  - ✅ Video support (Feature 7)
  - ✅ Annotations (Feature 8)
  - ✅ Real-time updates / WebSocket (Feature 9)

## Video support (no transcoding)

Feature 7. Admin-only upload of browser-playable video, stored and served as-is —
**no transcoding, no ffmpeg**. Browsers decode H.264 MP4/MOV and WebM natively, and
uploads are already served with HTTP range support (nginx `location /uploads/` in
prod, uvicorn `StaticFiles` in dev), so a stored file streams + seeks in a `<video>`
tag. No DB migration was needed — `Image.is_video` / `Image.video_poster_filename`
already existed (migration `0003`).

- **Accepted formats**: `video/mp4`, `video/quicktime`, `video/webm` (size cap
  `settings.max_video_bytes`, 2 GB). Known limitation: H.265/HEVC and ProRes upload
  but won't play in-browser (inherent to no-transcode).
- **Pipeline**: `image_service.upload_images` branches on video — applies the larger
  cap, validates magic bytes (ISO-BMFF `ftyp` / EBML), stores the original, sets
  `is_video=True`, marks the row `processing_status="done"` immediately, and **skips
  the Pillow `process_image` task** (no thumb/medium renditions).
- **Serving**: `_image_to_response` exposes `video_url` (the original file URL),
  always present for videos — independent of download/watermark gating, since video
  can't be watermarked. `thumb_url`/`medium_url` stay null.
- **Posters**: browser-native — the grid renders `<video preload="metadata">` seeked
  to the first frame (`#t=0.1`); no server-side poster is generated (`video_poster_*`
  reserved for a future ffmpeg option).
- **Frontend**: `PhotoGrid`/`AdminImageGrid` show a play badge over the video tile;
  `Lightbox` renders `<video controls autoPlay>`; `useImageUpload` accepts the video
  types with a 2 GB client-side limit. Client (public) upload stays images-only.
- **nginx**: the upload route caps `client_max_body_size 2g` with
  `proxy_request_buffering off` and 1800s timeouts.

## Watermarks (image + text)

Per-gallery, configured in **Settings → Security**. Stored as a JSON blob in
`Gallery.watermark_settings` (no dedicated columns / migration). Validated and
normalized by `schemas/watermark.py::WatermarkSettings`
(`{enabled, mode, opacity, size, position, filename, text, color}`); legacy rows
(`{filename, …}` without `enabled`/`mode`) stay valid and inactive until enabled.

- **Modes**: `image` (upload PNG/WebP via `POST /galleries/{id}/watermark`) or `text`
  (string + `color`, rendered with Pillow's built-in scalable font + auto-contrast
  outline — no font asset shipped).
- **Placement**: `opacity` (0–100), `size` (S/M/L), and a 9-key `position` grid
  (`top/center/bottom`-`left/center/right`), shared by both modes via
  `watermark_service._paste_xy`.
- **Active check**: `watermark_service.is_active(ws)` (single source of truth) is used by
  the public serializer (`gallery_service`) and the proxy (`public.py`). Replaces the old
  `enabled && filename` inline checks — note the feature was previously **never wired**
  (nothing set `enabled`), so it never composited before this.
- **Serving**: composited on the fly by `public.py::_watermarked_variant` for thumb/medium,
  cached to `{variant}-wm/` keyed on a settings hash (changing any setting busts the cache).
  Originals/video are never watermarked. Validation on write lives in
  `gallery_service.update_gallery` (400 on bad JSON/values).
- **UI**: `WatermarkFields` in `gallery-settings-fields.tsx` (enable, mode, opacity, size,
  `PositionGrid`, text+color); `GallerySettingsModal` holds the state and PATCHes
  `watermark_settings` as a JSON string. `WatermarkUpload` reports the new filename back
  via `onUploaded` to keep modal state in sync.

## Admin theming & gallery redesign

Architecture doc: `docs/architecture/admin-theming-and-gallery-redesign.md` (approved 2026-06-11).

- **Phase A** ✅ Admin theming — `app_settings.admin_theme` (light/dark, global instance
  setting), accent color applied to `--primary`/`--ring`/`--primary-foreground`, admin surface
  migrated from `zinc-*` literals to semantic theme tokens. Public pages and login stay
  always-dark; a pre-hydration script in `app/layout.tsx` + `AdminThemeProvider` (localStorage
  cache, keys in `src/lib/theme.ts`) avoid FOUC on `/admin`. Literal colors remaining in the
  admin surface are intentional: color-flag indicators and text over photo scrims.
- **Phase B** ✅ Per-gallery settings modal (`src/components/admin/GallerySettingsModal.tsx`) —
  tabbed General/Presentation/Collaboration/Security + a "Start client view in" mode toggle.
  Migration `0007` adds presentation columns (`opener_font`, `opener_font_size`, `preview_size`,
  `preview_spacing`, `preview_corners`, `bg_brightness`, `bg_dimmed_color`) and collaboration
  toggles (`color_flags_enabled`, `likes_enabled`, `comments_enabled`, `show_filename`,
  `show_exif`, plus not-yet-built `scribbles/sets/client_upload/show_iptc/contact_sheet` shown
  disabled with a "Coming soon" hint). `PATCH /api/galleries/{id}` gained `apply_to_subgalleries`
  to cascade look & behaviour (not identity) to direct children. Public rendering
  (`GalleryView`/`PhotoGrid`/`Lightbox`) consumes the new fields: layout/preview size→columns,
  spacing→gap, corners, background brightness, opener typography, filename caption, and gates
  flags/likes/comments/EXIF. The modal was later given a visual/structural redesign (Switch
  primitive `ui/switch.tsx`, icon tabs, hero mode cards, grouped sections, Downloads moved to
  the General tab) — see `docs/architecture/gallery-settings-modal-redesign.md`.
  - **Tabs regrouped by applicability (2026-06-13)** — the old mode-named Presentation/Collaboration
    tabs mixed cross-mode look settings with Review-only ones (and Review settings showed for
    Showcase galleries even though they do nothing there). Now: **General** (name, subtitle,
    downloads, client upload), **Look** (grid/lightbox appearance for *both* modes — layout,
    preview size/spacing/corners, background, filename, EXIF — plus a Showcase-only **opener**
    section: header image + heading font/size, shown only when mode=Showcase), **Review** (client
    feedback: color flags, likes, team voting, comments, collections — the tab is **hidden unless
    the gallery is in Review mode**), **Security**. Field groups in `gallery-settings-fields.tsx`
    are now `LookFields`/`OpenerFields`/`ReviewFields` (was `Presentation`/`Collaboration`Fields);
    `PresetEditorModal` mirrors this per mode (Showcase preset = Look+Opener, Review = Look+Review).
    No schema change — `GalleryUpdate`/`GalleryPreset` stay flat; only the UI grouping changed.
- **Phase C** ✅ In-gallery admin redesign (two-column layout). The gallery detail page
  (`app/admin/galleries/[id]/page.tsx`) is now two columns: a `GalleryAdminSidebar` (title +
  kebab → Activity/Voting/Delete; Settings/Preview/Share icons; Upload; Download; Filter by
  filename + flag chips + comments; Arrange Sort/Group; Sets shown "Coming soon") beside a clean
  canvas (header-image strip + "Set Header Image", `AdminImageGrid` with filename captions +
  optional flag grouping, a single minimal `UploadZone`, and a Sub-Galleries section + create
  dialog). Upload logic lives in `hooks/useImageUpload.ts` (aggregate progress, shared hidden
  input). The watermark/header-image/ZIP/activity/voting panels moved off the page: header →
  settings **Presentation** tab, watermark → **Security** tab, ZIP+txt export → a Download
  dialog, activity + voting → kebab dialogs (`ZipExport`/`ActivityFeed`/`VotingSummary` gained an
  `embedded` prop). Filter/sort/group are client-side over the loaded images (sort keys: Manual /
  File Name / Date Added / **Capture Date**). Detail-page children come from the cached
  `["galleries"]` tree since `api.galleries.get` returns `children: []`.

  - **Capture Date sort** — orders by EXIF `DateTimeOriginal` (already shipped in `exif_data`;
    the format is fixed-width so it sorts as a raw string), via `compareCaptureDate` in
    `frontend/src/lib/image-sort.ts`. Photos without a capture date always sort to the end. Shared
    by the admin in-gallery Arrange control (`GalleryAdminSidebar`) and the public viewer
    (`GalleryView`). No backend change — purely client-side over the loaded list.
  - Follow-ups (own roadmap items): drag-to-reorder ("Manual" sort = stored `sort_order`). The
    once-disabled Sets / client upload / scribbles (annotations) / IPTC features are now built;
    contact sheet was scrapped (migration `0028` dropped `contact_sheet_enabled`).

## Share links & public base URL

Migration `0008`.

- **Public base URL** — global `app_settings.public_base_url` (nullable). Set it in
  `/admin/settings` (General section) when clients reach galleries through a reverse proxy on a
  different domain (e.g. `gallery.example.com`). Share links use it as the origin, falling back
  to `window.location.origin` when unset. Edited via `PATCH /api/admin/settings`
  (`AppSettingsUpdate.public_base_url`; `""` clears, an `http(s)://…` origin sets it).
- **Customizable share links** — the gallery's `share_token` doubles as the URL slug
  (`/g/{token}`); privacy for a guessable slug comes from the gallery password. Customize via
  `POST /api/galleries/{id}/share-token` (`gallery_service.set_share_token`) with strategy
  `named` (slugify gallery name + `-2`/`-3` on collision), `random` (8-char base62), or `custom`
  (validated `^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$`; 409 if taken). Uniqueness checked via
  `gallery_repo.share_token_exists` (ignores `deleted_at` since the unique constraint covers
  soft-deleted rows). UI: `src/components/admin/ShareDialog.tsx` (opened from the sidebar Share
  action) shows the full link + copy, a slug input with Save, "Use gallery name" / "Random short"
  buttons, and a guessable-link warning when the slug isn't a UUID and the gallery has no password.

## Gallery creation, default mode presets & settings nav

Migration `0009`. Architecture doc: `docs/architecture/gallery-create-presets-and-settings-nav.md`.

- **Simple create dialogs** — `CreateGalleryDialog` (title + Collaboration/Presentation mode
  cards, Cancel/Create/Create & Open) for top-level galleries; `CreateSubGalleryDialog`
  (title only) for sub-galleries. The old all-fields `GalleryForm` is gone — everything else
  is configured later in `GallerySettingsModal`.
- **Default mode presets** — `app_settings.preset_presentation/preset_collaboration` (JSON,
  nullable = built-in defaults), validated by `schemas.settings.GalleryPreset`
  (`extra="forbid"`, look & behaviour fields only). Edited via `PATCH /api/admin/settings`
  (object replaces, explicit `null` resets). `gallery_service.create_gallery` resolves
  defaults via `_resolve_create_defaults`: sub-galleries copy the parent
  (`_INHERIT_CREATE_FIELDS` = cascade minus `sort_order`, incl. `mode`); top-level galleries
  merge the preset for their mode (`_PRESET_FIELDS`); explicit request fields always win.
- **Settings sub-routes** — `/admin/settings` redirects to `branding`. The admin layout sidebar
  swaps to a section nav (in `SETTINGS_NAV`) grouped by topic, with an "All Galleries" back
  link (same mechanism as the gallery detail sidebar portal). Reorganized 2026-06-13 from the old
  audience grouping (General/Appearance/Admin View) into:
  - **Branding**: `branding` (studio name, **logo**, masthead branding [`brand_display` logo/name,
    `brand_font` via the gallery font registry, `brand_color`, `tagline`] + **accent color**),
    `footer` (public branding footer, see below).
  - **Client galleries**: `gallery-defaults` (preset rows + `PresetEditorModal`, **high-res
    previews** toggle, + **lightbox backdrop** — all under a "Viewing" section).
  - **Workspace** (admin-only personal prefs): `workspace` (admin **theme** + admin-view grid /
    overview prefs, see "Admin View settings"), `general` (public base URL + technical bits).
  - Old routes `appearance` and `admin-view` are now server `redirect()`s to `workspace`.

## Admin View settings

Migration `0014`. Architecture doc: `docs/architecture/admin-view-settings.md`. Instance-level,
admin-only view preferences on `app_settings` that never affect the public gallery; edited in
`/admin/settings/workspace` (was `/admin/settings/admin-view`), surfaced via the existing
`GET`/`PATCH /api/admin/settings`.

- **Admin gallery photo grid** — `admin_grid_mode` (`mirror` = WYSIWYG default, follows each
  gallery's client look / `custom` = use override) + `admin_grid_view` (JSON look blob, shape
  `schemas.settings.AdminGridView`: `layout`/`preview_size`/`preview_spacing`/`preview_corners`,
  all optional → built-in default; same object-replaces / explicit-null-resets handling as the
  gallery presets). The gallery detail page builds the `AdminImageGrid` `layout`+`presentation`
  props from the override when custom, else from `gallery.*`.
- **Gallery overview** (`/admin/galleries`) — `overview_size` (→ `GRID_COLS` columns),
  `overview_shape` (`square`/`aspect`), `overview_spacing` (→ `GAP`), `overview_corners`
  (`round` = `rounded-lg` / `square` = `rounded-none`), `overview_sort`
  (`created` = API order / `name` / `photos`, sorted client-side over the loaded list).

## Drag-and-drop organising (admin)

Architecture docs: `docs/architecture/drag-and-drop-organize.md` (photo moves + overview reparent)
and `docs/architecture/nested-galleries-and-reparent-dnd.md` (unlimited nesting + centralised
reparent + every drag surface).

**One `DndContext` in the admin layout** (`components/admin/AdminDnd.tsx` → `AdminDndProvider`) spans
the portalled gallery sidebar, the far-left nav tree, and the page. The provider **owns gallery
reparenting** (the `api.galleries.move` mutation, a universal collision, one `onDragEnd` that
reparents galleries and delegates image moves/reorder to the page, and one cursor-pinned
`DragOverlay` — gallery chip via an inline `snapCenterToCursor` modifier, image overlay via the
page's `renderOverlay`). Pages register only `{ onDragEnd, renderOverlay }` via `useAdminDndRegister`
and read the in-flight drag via `useAdminDndActive`. Sensors are fixed in the provider (8px
threshold). Unified data: **drop zones** carry `data.galleryId` (or `data.topLevel`) with ids
prefixed `gallery:`/`topLevel`; **gallery drag sources** carry `data.reparent`+`galleryId`/`parentId`
/`name`; ids are unique per surface (`{id}:card|tile|chip|tree`) so the same gallery in several
places doesn't collide. The `onDragEnd` branches on the active's kind (image vs gallery).

- **Move photos** (gallery detail page) — drag a thumbnail onto a sub-gallery card or a nav folder
  (both `data.galleryId`) → `POST /api/images/{id}/move` (toast + Undo; invalidates all
  `["gallery-images"]` so the destination refreshes). Reorder (manual sort) still works. Without
  drag: the tile kebab's **"Move to gallery…"** opens a picker (`moveImageTarget` dialog) listing the
  whole gallery tree depth-indented (`flattenTree`) with a name filter; the image's current gallery
  is shown flagged "Current" (disabled).
- **Reparent galleries — any depth** — drag a gallery onto another to nest it, or onto a "top level"
  zone to un-nest → `POST /api/galleries/{id}/move` (`gallery_service.move_gallery`,
  `GalleryMove.target_parent_id`; `null` = top level). Nesting is **unlimited**; the only block is
  moving a gallery into itself or a descendant (cycle). Surfaces: detail-page **Sub-Galleries cards**
  (card→card), the far-left **`GalleryTree`** nodes (shown on non-detail pages; header = un-nest
  zone), and the **overview** in *Organize* mode (tiles + sub-gallery chips). No migration
  (`parent_id`/`sort_order`). The public gallery breadcrumb renders the full `ancestors` chain.

## Sub-gallery navigation (public)

Architecture doc: `docs/architecture/subgallery-navigation-redesign.md`. A gallery is a
**container** when it has sub-galleries but no photos of its own
(`image_count === 0 && subgalleries.length > 0`).

- **Container** → children render as centered cover cards (`GalleryView.subGalleryCards`, a centered
  `flex-wrap`); the photo grid is suppressed.
- **Content** (has own photos) → photos own the page; children surface only via the breadcrumb.
- `components/gallery/GalleryBreadcrumb.tsx` (`Ancestor › … › **Current** › child · child`, text
  links — the full `ancestors` chain from the public response, for any nesting depth) is shown in
  presentation mode and replaces the old inline "Back" cover card. Collaboration mode keeps its
  sidebar nav and just applies the same container gate to the main-column cards.
- No backend change — `image_count` (own photos), `subgalleries`, and `parent_*` already ship on
  `GalleryPublicResponse`. The admin in-gallery view keeps its own "Sub-Galleries" management section.

## Public branding footer

Migration `0015`. Architecture doc: `docs/architecture/gallery-branding-footer.md`. A single global
footer shown at the bottom of every public gallery (business name, website link, accent-colored
contact/social icon circles). Edited in `/admin/settings/footer` via the existing
`GET`/`PATCH /api/admin/settings`.

- **Storage** — `app_settings.footer_enabled` (bool) + `app_settings.footer` (JSON content blob,
  shape `schemas.gallery.FooterSettings`: `business_name`, `website_url`, `email`, `phone`,
  `instagram`, `facebook`, `x`, `tiktok`, `youtube`, `linkedin`; blank strings stripped to `None` so
  they don't render). `FooterSettings` lives in `schemas.gallery` (not `settings`) so the public
  gallery response can embed it without a circular import.
- **Public exposure** — `get_public_gallery` adds `accent_color` and `footer` to
  `GalleryPublicResponse` (footer only when `footer_enabled`); no new endpoint, it rides the
  already-loaded gallery response.
- **Rendering** — `components/gallery/GalleryFooter.tsx`, placed at the bottom of every
  `GalleryView` layout (collaboration + both presentation variants). Icon circles use
  `accent_color`; social brand glyphs are inline SVGs since lucide-react dropped brand icons
  (only `Mail`/`Phone` come from lucide). Footer text follows the gallery's `bg_brightness` flag.
- **Shared form fields** — `gallery-settings-fields.tsx` (`PresentationFields`,
  `CollaborationFields`, `Segmented`/`Row`/`Toggle`) used by both `GallerySettingsModal`
  and `PresetEditorModal`.

## Gallery opener fonts

Architecture doc: `docs/architecture/gallery-opener-fonts.md`. A categorized font
picker for the per-gallery **presentation opener heading** — Sans Serif · Serif · Display/Script ·
Mono · Accessibility. Presentation mode only; collaboration-mode chrome keeps the UI font.

- **Registry** — `frontend/src/lib/gallery-fonts.ts` is the single rendering source: declares every
  `next/font` instance (self-hosted; Google families via `next/font/google`, the four non-Google
  a11y faces via `next/font/local` from vendored woff2 in `frontend/src/fonts/`, each with its
  license), and exports `GALLERY_FONT_GROUPS` (picker), `GALLERY_FONT_VARIABLES` (CSS-var classes
  added to `<html>` in `layout.tsx`), and `resolveOpenerFont(key)` → `{ fontFamily, fontWeight }`.
  All instances use `preload: false`, so only a gallery's chosen font is fetched. **next/font calls
  need literal option objects — no spread.**
- **Per-font heading weight** — the opener `<h1>` no longer hard-codes `font-bold`; weight comes
  from the registry so single-weight display/script faces (Pacifico, Pinyon, Bebas…) render right.
- **Picker UI** — `components/admin/FontPicker.tsx` (self-contained popover, no Radix dep; each
  option previewed in its own face), used inside `PresentationFields` (`gallery-settings-fields.tsx`)
  → `GallerySettingsModal` + `PresetEditorModal`.
- **Validation / compat** — backend `schemas.gallery.FontType` widened to a `Literal` of all
  registry keys **+** legacy `sans/serif/mono` aliases (kept in sync with the frontend registry).
  No migration — `opener_font` is already `String(40)`; legacy values keep rendering as before and
  the default stays `"sans"`.

## Client uploads

Migration `0017`. Architecture doc: `docs/architecture/client-uploads.md`. Lets public gallery
visitors contribute photos when the photographer enables the per-gallery `client_upload_enabled`
toggle (General settings tab — client upload works in both modes). Uploads appear in the gallery **immediately, visible to
everyone**, attributed to the uploader's reviewer name.

- **Backend** — `Image.uploaded_by` (nullable; reviewer name for client uploads, null for admin
  uploads) on `ImageResponse`. `image_service.upload_images` gained an `uploaded_by` param;
  `image_service.client_upload_images` is the public wrapper that enforces
  `client_upload_enabled` (403), a per-request count cap (`CLIENT_UPLOAD_MAX_FILES = 50`), and a
  `"Guest"` fallback name, then delegates. Public endpoint
  `POST /api/public/g/{share_token}/images` (multipart `files` + `uploader`) honours the gallery
  password via `_require_gallery_access` and reuses the same MIME/magic/size checks +
  `BackgroundTasks` processing as admin upload. `client_upload_enabled` already rides
  `GalleryPublicResponse`.
- **Frontend** — live "Client upload" toggle in `CollaborationFields` (passed as a `clientUpload`
  render-prop from `GallerySettingsModal` so it stays **out** of `CollaborationValues` / the
  `extra="forbid"` preset payload). `api.public.uploadImages` (XHR + progress, mirrors admin
  upload). `components/gallery/ClientUploadButton.tsx` — self-contained "Add photos" trigger
  (reviewer-name prompt reusing the voting store → file picker → progress → invalidates
  `["public-images", …]`, with a delayed re-invalidate for background thumbnails); dropped into all
  three `GalleryView` layouts (collab sidebar + both presentation headers) when enabled.
  `AdminImageGrid` tiles show a persistent "↑ {uploaded_by}" badge for client contributions.
- **Security trade-offs** — client upload (and every public write) is now **per-IP rate-limited**
  (see "Public write rate limits" below). The "visible immediately" default is opt-out via
  **moderation** (below). Follow-ups: presets, dedicated upload sub-gallery.

## Client upload moderation (approval queue)

Architecture doc: `docs/architecture/client-upload-moderation.md` (implemented 2026-06-15). Migration
`0029`. Optional per-gallery **approval queue** that closes the client-upload "visible immediately"
trade-off: when enabled, client uploads land **pending** (invisible to the public) until the
photographer approves them. Admin uploads are never moderated.

- **Data** — `images.moderation_status` (`approved`/`pending`, default `approved`; reject =
  soft-delete, no third state) + `galleries.client_upload_moderation` (bool, default off; cascades via
  `apply_to_subgalleries`, kept out of `GalleryPreset` like `client_upload_enabled`).
- **Hiding from the public** — `image_repo.get_by_gallery` + `gallery_repo.count_images` /
  `batch_image_counts` gained an `only_approved` flag; the **public** path passes it
  (`get_public_gallery` image_count + child nav counts, `get_public_images` list), the **admin** path
  doesn't (pending shows inline, badged). So a gallery whose only photos are pending reads as empty
  publicly (container/content gate stays correct). Cover queries are intentionally not gated (a
  pending upload can't auto-become a cover — append-ordering; only an explicit admin pin could).
- **Approve** — `image_service.approve_image` / `approve_images` (bulk); admin endpoints
  `POST /api/galleries/{id}/images/{image_id}/approve` and `…/images/approve` (`{image_ids}`). Flips
  to `approved`, logs an `"approved"` activity, re-publishes the realtime `"image"` signal so the
  public room picks it up. **Reject** reuses the existing soft-delete (`DELETE /images/{id}`).
- **Notify** — new `"upload"` notification event (`EVENT_KEYS` + `NotificationEvents.upload`),
  enqueued from `client_upload_images` only when the upload is pending; coalesced with a
  `📤 N awaiting review` flush line; toggle in `/admin/settings/notifications`.
- **Realtime** — no new signal type; `process_image` keeps publishing `"image"`. Public refetch is
  `only_approved`, so a pending upload is a harmless no-op until approval (self-heals).
- **Frontend** — General-tab "Require approval" toggle nested under Client upload
  (`GallerySettingsModal`); `admin-grid-tile` pending tiles get an amber **Pending** badge + hover
  **Approve**/**Reject**; `PendingReviewBanner` above the admin grid shows "N pending" + **Approve
  all** (`api.images.approveBulk`); `ClientUploadButton` takes a `moderation` prop → "awaiting
  approval" toast and skips the grid re-invalidate when on.

## Public write rate limits

Architecture doc: `docs/architecture/public-write-rate-limits.md` (implemented 2026-06-15). The
slowapi per-IP limiter (`app/rate_limit.py`, keyed on the reverse-proxy real IP, in-memory →
single-process) previously guarded only `login` + gallery-password `auth`. It now covers **every
public write**: client upload + ZIP (`10/minute`, heavy), collection create (`20`), comment +
collection delete (`30`), and flag/like/vote (`120/minute` — generous so a reviewer racing through a
big gallery never trips). Each route takes `request: Request` + an `@limiter.limit(...)` decorator;
`main.py` already wires `RateLimitExceeded` → **429**. Frontend: `getErrorCode` maps a bare 429 →
`errors.rate_limited` for a localized "slow down" toast. No migration, no new dependency.

## Collections (image selection + saved sets)

Migration `0018`. Architecture doc: `docs/architecture/collections.md`. Multi-select images and
save them as a named **Collection**, in both the admin in-gallery view and the public
collaboration ("review") view. Activates the previously-scaffolded `sets_enabled` toggle
(relabelled "Collections" in settings).

- **Data** — `collections` (id, gallery_id, name, `created_by` = reviewer name for client-made /
  null for admin, created_at) + `collection_images` (collection_id, image_id, position; PK both).
  Models in `app/models/collection.py`; hard-delete (soft-delete rule is Gallery/Image only).
- **Backend** — `collection_repo` / `collection_service` (create validates name + filters
  image_ids to live images of the gallery; `_to_response` embeds `image_ids` + a `cover_url` from
  the first member, dropping soft-deleted members). Admin router `app/routers/collections.py`
  (`GET`/`POST /api/galleries/{id}/collections`, `DELETE …/{collection_id}`) is always available
  (admin tool). Public endpoints in `public.py` (`GET`/`POST`/`DELETE
  /api/public/g/{share_token}/collections`) are gated by `gallery.sets_enabled` (403) + the
  password access check; `created_by` comes from a `creator` field (→ "Guest" fallback). Same
  unauthenticated-name trust model as flags/comments — anyone with access can create/delete.
- **Selection** — `hooks/useImageSelection.ts`: a "Select" mode (click toggles, shift-click range
  from anchor, Ctrl/Cmd+A selects all visible, Esc clears) — a full-tile selection mode, not a corner "+".
  Threaded into `AdminImageGrid` tiles and public `PhotoGrid` tiles (full-tile ring + check;
  drag/lightbox suspended in selection mode — the admin page also turns off `draggable`/`dragEnabled`).
- **UI** — Collections panel replaces the old "Sets — Coming soon" block in both
  `GalleryAdminSidebar` (always shown) and the `GalleryView` collaboration sidebar (shown when
  `sets_enabled`): Select toggle, selection actions (count, Select all, Clear, Save as
  collection), "Save current filter as collection", and the collections list — click to **filter**
  the grid to a collection (an `activeCollection` id intersected in the `filteredSorted` memo),
  **Download** (reuses `createFilteredZip(image_ids)`), and **Delete**. Admin rows show
  `created_by`. Save-name dialogs: shadcn `Dialog` (admin) / dark overlay (public).
- **Settings** — `sets_enabled` is a live per-gallery toggle ("Collections") in `ReviewFields`, and
  is also a **mode-preset default** (in `ReviewValues` + `GalleryPreset` + `_PRESET_FIELDS`, since
  2026-06-15). Was originally a `sets` render-prop kept out of the preset; promoted to a first-class
  review field alongside `annotations_enabled`. (Client upload / moderation stay per-gallery-only.)
- **Editing** (see `docs/architecture/collections-editing.md`, 2026-06-15) — collections are
  editable after creation. `CollectionUpdate{name?, image_ids?, actor?}` via `PATCH
  …/collections/{id}` (admin + public): `name` renames, `image_ids` is a **full ordered membership
  replacement** (covers add / remove / reorder in one call, validated against live gallery images,
  ≥1 member required). `collection_service._authorize` enforces **creator-or-admin** (public reviewer
  name must match `created_by`; admin bypasses) on **both** update and delete — closing the prior
  hole where any visitor could delete any collection. Frontend shipped: admin rename + add-selection +
  per-tile "Remove from collection"; public rename + creator-restricted delete (affordances gated on
  `created_by === reviewerName`). **Deferred**: drag-reorder UI (both surfaces) and public member
  add/remove — the backend already supports them.
- **Follow-ups** (out of scope): drag-reorder UI, public member add/remove, presets,
  presentation-mode collections, cross-gallery collections.

## Admin galleries — contextual navigator

Architecture doc: `docs/architecture/admin-galleries-contextual-navigator.md`. Reworks
`/admin/galleries` from "rail + canvas both list the top level" (duplicate) into a file-browser
(Finder/Lightroom master–detail): the left rail (`GalleryTree`) is the persistent "where am I"
navigator; the canvas shows "what's here" — the contents of the currently-browsed folder. No
backend/migration — everything rides the existing `["galleries"]` tree response.

- **One click rule (rail + canvas)** — **has sub-galleries → browse into it** (`g.children.length > 0`);
  a **leaf** (no children) opens its detail page `/admin/galleries/{id}`. Behaviour follows the
  visible folder/`Layers` badge, so it's predictable from the card. A browsed folder that *also* has
  its own photos surfaces them as an accent-ringed **`OwnPhotosCard`** (first cell, "View photos →")
  that opens detail — Drive/Dropbox model: entering a container shows everything inside it, photos
  represented as one entry rather than the full grid (no duplication of the detail page).
- **Reaching a folder's own detail/settings** — since clicking a folder browses in, the breadcrumb's
  current crumb carries a **manage gear** (`Settings2`, `onManage`) that opens its detail page. This
  is the only path to a *pure* container's photos/settings (it has no `OwnPhotosCard`).
- **Current folder in the URL** — `/admin/galleries?folder={id}` (`useSearchParams`; null = root),
  so Back/refresh/links work. The page must keep `useSearchParams` under a `<Suspense>` boundary
  (Next 16 prerendering). The rail reads the same param to highlight + auto-expand the path
  (`galleryPath(roots, id)` in `lib/gallery-sort.ts`, also drives the canvas breadcrumb).
- **Photo-first card** — full-bleed cover with title + count on a clean line *below* the image
  (replaced the old dark-scrim overlay); status as small cover overlays (`Lock`, `Users` for
  collaboration, `Layers`+count for sub-galleries). Container cards count galleries, content cards
  count photos.
- **Organize mode** retained for drag-to-reparent; the old inline "child chips under each root card"
  were removed (you browse into folders now). Cross-level reparent still works by dragging onto the
  rail tree or the top-level drop zone.
- **Scope** — overview page + shared rail behavior only; the gallery **detail** page keeps its
  per-gallery management sidebar unchanged. Distinctive here: a depth-aware folder tree +
  editorial cards (a file-browser master–detail rail, not plain section nav).

## Mobile responsiveness

Architecture doc: `docs/architecture/mobile-responsive.md`. Content already reflowed (photo grids,
Next default viewport meta); the gap was the two **pinned fixed-width sidebars**. Pattern: below the
`md` breakpoint each sidebar is the **same `<aside>` element**, restyled via Tailwind `max-md:` into a
left off-canvas drawer (`max-md:fixed inset-y-0 left-0 -translate-x-full` → `translate-x-0` on a
`drawerOpen` boolean) with a `md:hidden` backdrop + trigger; at `md+` it's the original static column.

- **Why one element, not a `Sheet`** — the detail page portals its sidebar into a single DOM id
  (`#gallery-admin-sidebar-slot`). A separate drawer element (Base UI `Sheet`) would duplicate that id
  and break the portal when the viewport crosses the breakpoint. One always-mounted element that just
  restyles keeps the slot stable, so `SidebarPortal` (and everything portaled into it) is untouched.
  No `Sheet`/`useIsMobile`/media-query hook was added.
- **Admin shell** (`app/admin/layout.tsx`) — `sidebarInner` rendered once in that one aside; a
  `md:hidden` top bar with a hamburger toggles `drawerOpen`; Esc + backdrop close it; a
  `<Suspense>`-wrapped `CloseDrawerOnNav` (`usePathname`+`useSearchParams`) closes it on any nav incl.
  `?folder=`. Fixes overview + detail + settings together.
- **Public collaboration** (`components/gallery/GalleryView.tsx`) — same drawer (themed to `bright`)
  behind a `md:hidden` "Filters & tools" bar; grid full-width on mobile. Presentation mode unchanged
  (already fine).
- **Audit** — `GallerySettingsModal` already mobile-safe (width cap + `max-h-[55vh]` body scroll).
- **Lightbox touch (2026-06-15)** — `Lightbox.tsx` now has real swipe gestures: the photo
  follows the finger (horizontal → prev/next past a 60px commit, vertical-down past 90px → close,
  with a direction-lock + finger-fade on dismiss). Handlers live on the image area only (not the
  whole overlay, so panel scrolling isn't hijacked), and are skipped while annotating (the pen owns
  the pointer) and on video (native scrubber). The collaboration flag circles + like hit area are
  bumped on mobile (`h-9 w-9` → `sm:h-6 sm:w-6`) for a ≥36px touch target; desktop is unchanged.

## Gallery theme scope & shared chrome

Architecture doc: `docs/architecture/gallery-theme-scope-and-shared-chrome.md` (implemented
2026-06-13). Makes the **public client gallery** and the **admin in-gallery view** render the same
chrome from one definition, ending the recurring drift where the public side hand-copied the
admin's shadcn look with parallel `zinc-*` classes (buttons diverged to `h-8` vs `h-7`, etc.).

- **`.gallery-scope`** (in `globals.css`) — a CSS class that redefines the standard shadcn semantic
  tokens (`--background`/`--foreground`/`--primary`/`--border`/`--input`/…) from the gallery's tone,
  pulled from Tailwind's zinc ramp: base class = light, `.gallery-scope.dark` = dark. The
  `GalleryView` root carries `gallery-scope text-foreground` + conditional `dark` (`!bright`). The
  `.dark` **class** (not just an attribute) is needed so shadcn `dark:` variants resolve; the
  `text-foreground` is needed because a token-variable redefinition alone doesn't change inherited
  `color` (the public `<body>` computes to the dark fg = white), which made `outline` buttons — they
  inherit their text color — render white-on-white until the scope re-applied `color`.
- **Root `<html>` no longer forces `dark` on `/g/`** (`app/layout.tsx` pre-hydration script) — it
  hard-codes `… dark` and previously stripped it only for `/admin`·`/login`·`/setup`, so a token
  override couldn't un-match the ancestor `.dark` and shadcn `dark:` variants leaked into a *bright*
  gallery (grey filter input / outline buttons). The script now drops `dark` on `/g/…` so the
  `.gallery-scope` is the sole tone authority; `PasswordGate` (shadcn) is wrapped in
  `<div className="dark">`, the other pre-gallery states use explicit `zinc-950`.
- **Shared `GalleryToolbar`** (`components/gallery/GalleryToolbar.tsx`) — one semantic-token toolbar
  used by both surfaces. Admin `GalleryViewToolbar` is now a thin wrapper passing the sticky
  `-mx-6 -mt-6 px-6` positioning; the client renders it with `px-4` inside the scope + a `features`
  gate (`{colorFlags, comments}`). The old duplicated `GalleryClientToolbar.tsx` was deleted.
- **Sidebar = real primitives** — the client collaboration sidebar's Download/Add photos/Select +
  the whole collections panel now use the actual shadcn `<Button>`/`buttonVariants` (byte-identical
  to admin), and the nav links / masthead / title / sub-gallery cards use semantic tokens instead of
  `bright ? … : …`. `ClientUploadButton` keeps its own icon, so it gets `buttonVariants(...) + gap-3`
  to match the admin's `gap-1 + mr-2` spacing.
- **Also** — the leading `Camera` masthead icon was dropped on both surfaces (logo still renders if
  uploaded); the client manual-sort label now reads "Manual" (was "Default").
- **Still on zinc literals** (intentional — no admin twin, so no drift): the photo grid empty/group
  states, presentation-mode hero/header layouts, save-collection dialog, mobile menu bars, loader,
  `PhotoGrid`/`Lightbox`. The `bright` boolean stays for those.

## Design system & shared chrome

Conventions: **`docs/design-system.md`**. Architecture doc:
`docs/architecture/design-system-and-shared-chrome.md` (implemented 2026-06-15). A lightweight,
app-wide standard for the small visual primitives that kept getting re-implemented with drifting
opacity/size/icons across the photo grids, lightbox, and gallery overview. No migration (frontend).

- **Icon registry** — `src/lib/ui-icons.ts` (`Icons`): one concept→lucide-glyph map (e.g.
  `Icons.annotation` = PenLine everywhere; `Icons.rename` = Pencil, ending the old Pencil double-duty).
  **Import the concept, not the raw glyph** for any registered concept; raw lucide stays fine for
  one-offs.
- **`<OverlayPill>`** (`src/components/chrome/OverlayPill.tsx`, cva `overlayPillVariants`) — the single
  definition of the translucent-black on-photo pill. `variant` control (interactive, hover-darkens) vs
  badge (read-only); `size` xs/sm; `shape` rounded/pill/iconPill/circle; polymorphic `as`. Opacity/
  scrim literals live in `src/lib/ui-tokens.ts` (`OVERLAY_REST`/`OVERLAY_HOVER`/`BADGE_BG`/
  `OVERLAY_SCRIM`) — kept as full literal classes so Tailwind v4's source scan emits them.
- **`<MediaBadge>`** (`src/components/chrome/MediaBadge.tsx`) — the unified comment/annotation count
  badge, owns the `comment_count − annotation_count` math, canonical **bottom-right** `xs` look, used
  identically by admin (`admin-grid-tile`) and client (`PhotoGrid`) tiles. Admin moved from top-left.
- **`<ConfirmDialog>`** (`src/components/chrome/ConfirmDialog.tsx`) — controlled themed confirm built
  on the shadcn `Dialog`; **replaces the two `window.confirm` calls** (comment + annotation delete).
  `open`/`onOpenChange` + `onConfirm` + `destructive`/`pending`.
- **`<DropdownMenu>`** (`src/components/ui/dropdown-menu.tsx`) — kebab/dropdown primitive on Base UI's
  `menu` (keyboard nav + focus + portalled positioning). Parts: `DropdownMenu`/`DropdownMenuTrigger`/
  `DropdownMenuContent` (`side`/`align`/`sideOffset`)/`DropdownMenuItem` (`destructive`/`disabled`)/
  `DropdownMenuSeparator`. Replaced the two hand-rolled fixed-position dropdowns (admin tile kebab +
  `GalleryAdminSidebar`); the trigger takes a `className` (e.g. `overlayPillVariants(...)` for the
  on-photo kebab).
- **Lightbox open-intent** — `store/lightbox.ts` `open(images, index, intent?)`; the `Lightbox`
  mounts fresh on open (`{isOpen && <Lightbox/>}` on both surfaces) so it **seeds its panel state**
  (`showComments`/`showAnnotations`) from `intent.panel` ("comments"/"annotations") in `useState`.
  The annotations panel implies comments. Both client tiles (gated by `features.comments`/
  `features.annotations`) and admin tiles (always — the photographer's tool) gained hover comment +
  annotation `OverlayPill`s that open straight to the matching panel. Admin intent is threaded
  `onOpen(img, intent?)` → `openPreview` → `openLightbox` (`CardProps.onOpen` / `AdminImageGrid` prop).

## Internationalization (i18n)

Architecture doc: `docs/architecture/i18n-and-localization.md` (implemented 2026-06-14). Contributor
flow: `TRANSLATING.md`. Ships **English + German**; the public gallery auto-detects the visitor's
language, the admin picks theirs in **Settings → Workspace**.

- **Library**: `next-intl` in **"without i18n routing"** mode — locale comes from the `NEXT_LOCALE`
  cookie → `Accept-Language` → `en` (resolved in `frontend/src/i18n/request.ts`), so `/g/{token}`
  share links never gain a locale prefix. Provider + `<html lang>` set in `app/layout.tsx`.
- **Catalogs**: `frontend/messages/{en,de}.json` — `en.json` is the source of truth (576 ICU keys),
  nested by surface (`gallery.*`, `admin.*`, `settings.*`, `auth.*`, `common.*`, `errors.*`). Use
  **ICU MessageFormat** for plurals/interpolation; one `useTranslations(ns)` per component.
- **Validate** before committing catalog changes: `cd frontend && node scripts/validate-i18n.mjs`
  (ICU parse + en↔de parity + arg consistency + key-resolution against `en.json`).
- **Backend stays English.** Client-visible errors (wrong gallery password, expired, upload too
  large/wrong type, client-upload disabled) carry a stable `code` via `CodedHTTPException`
  (`backend/app/errors.py`); the frontend maps `code → errors.*` message (`getErrorCode` in
  `src/lib/api.ts`), falling back to the raw detail. Adding `admin_locale` was migration `0024`.
- **Community translation** runs on **Weblate** (`https://translate.nielsbox.cc`) against the Forgejo
  repo: git push → Forgejo webhook → Weblate auto-pull; translators edit in Weblate → it commits to a
  `weblate` branch → PR into `main`. Deployment stack + runbook: `deploy/weblate/`. **Adding a locale**:
  register it in `frontend/src/i18n/locales.ts` (`SUPPORTED_LOCALES` + `LOCALE_LABELS`).

## Notifications

Architecture doc: `docs/architecture/notifications.md` (implemented 2026-06-14). Notify the
photographer when a client acts in a gallery — **comment**, **collection** saved, **flag** (color
flag / like / vote, one bucket), **view** (share link opened). Channels are pluggable via
**Apprise** (e-mail, Pushover, Discord, ntfy, Telegram…); delivery is **outbox + periodic flush**
so bursts coalesce into one message per gallery. Migration `0025`.

- **Config** — global `app_settings.notifications` JSON (shape `schemas.notifications.NotificationSettings`:
  `enabled` master switch, per-event `events`, `flush_seconds`, `channels[]`). Each channel is either
  a **preset** (`type` ∈ email/pushover/ntfy/discord/telegram/slack + structured `params`, from which
  the Apprise URL is built server-side) or `type="custom"` with a raw Apprise `url` (see
  **Channel presets** below). Credentials carry secrets → **masked on read** (`mask_settings`: custom
  masks `url`+`has_url`, presets mask each secret `param`+`secrets_set`) and **merged on write**
  (`merge_incoming` keeps the stored value when the client sends a blank/masked one). Edited via the
  existing `GET`/`PATCH /api/admin/settings`. Per-gallery master switch `gallery.notifications_enabled`
  (operational — never cascades, never on `GalleryPublicResponse`), toggled in `GallerySettingsModal` → General.
- **Emit** — `notification_service.enqueue(db, gallery_id, event_type, author, meta)` early-returns
  unless (global enabled) ∧ (event type on) ∧ (gallery switch on), else writes a
  `notification_outbox` row; never raises into the request. Call sites: `comment_service`,
  `image_service.public_set_flag`/`public_increment_like`, the public `vote` route (all next to the
  existing `activity_repo.log`), `collection_service.create_collection` (client-made only, plus a new
  `"collection"` activity log), and `public.get_public_gallery` (`view`, **enqueue-only — no activity
  row**, skipped when `get_optional_admin` is true so the photographer's own preview doesn't notify).
- **Flush** — a single in-process async loop started in `main.py::_lifespan`
  (`notification_service.run_flusher`, cancelled on shutdown — no cron/Celery). Each tick groups
  unsent rows per gallery, builds one summary (rare events itemised, `flag`/`view` counted), and
  sends to each enabled channel via Apprise in a thread executor. At-least-once; a failing channel
  leaves rows pending and retries until a ~10-min give-up. Sent rows are pruned by the startup
  cleanup (older than `zip_ttl_hours`).
- **Test** — `POST /api/admin/settings/notifications/test` sends a one-off via Apprise, built from
  `{type, params}` / `{url}` (a channel being composed, real creds) or `{channel_id}` (resolve the
  stored channel when secrets are masked/unchanged); surfaced as a per-channel **Test** button in
  `/admin/settings/notifications`.

### Channel presets

Architecture doc: `docs/architecture/notification-channel-presets.md` (implemented 2026-06-14).
Friendly per-service forms instead of hand-written Apprise URLs. **`app/notifications/presets.py`** is
the single source of truth: `FIELDS` (per type: which fields, `secret`/`required`) + `build_url(type,
params, url)`. Schema validation (`NotificationChannel._normalize` drops unknown params / clears `url`
for presets), masking and merge (`mask_settings`/`merge_incoming`, per secret field), the flusher and
the test endpoint all read it, so they never drift. No migration (JSON blob; legacy channels with no
`type` → `custom`). Frontend mirror for rendering only: `src/lib/notification-presets.ts` (field keys
kept in sync; the backend stays the URL-building authority); service picker + per-type fields in
`src/app/admin/settings/notifications/page.tsx`. Services: email (SMTP), pushover, ntfy, discord,
telegram, slack + custom (raw Apprise URL).
- **Apprise** — added to `backend/requirements.txt`; isolated behind `app/notifications/apprise_client.py`
  (`send(url, title, body) → bool`, never raises, returns False if the lib is missing).

## Annotations (anchored comment pins)

Feature 8. Architecture doc: `docs/architecture/annotations.md` (implemented 2026-06-14). Migration
`0027`. Lets clients (and the photographer) **draw feedback directly on a photo** — a freehand pen
stroke that carries a written note. Each mark **is a comment with a spatial anchor**, reusing the
whole comment stack (storage, endpoints, notifications, activity, counts). (Originally shipped with
Pin + Rectangle marks; switched to a single freehand pen at the maintainer's request — `pin`/`rect`
remain valid anchor types for backward-compat but are no longer offered in the UI.)

- **Data** — one nullable `comments.anchor` JSON column; `NULL` = an ordinary comment. Shape validated
  by `schemas.comment.Anchor` (`extra="forbid"`): `type` ∈ `freehand`/`pin`/`rect`. `freehand` carries
  a `points` path (`[{x,y}…]`, 2–`MAX_FREEHAND_POINTS`=1000); legacy `pin`/`rect` carry `x/y` (+ `w/h`).
  All coords are fractions `0..1` of the image's intrinsic box (resolution-independent); optional
  `#rrggbb` color. Anchored comments still count as comments (`comment_count`).
- **Rename** — the scaffolded `scribbles_enabled` flag → **`annotations_enabled`** everywhere
  (model/schemas/`_PASSTHROUGH_UPDATE_FIELDS` cascade/types/UI/i18n). Since 2026-06-15 it's also a
  **mode-preset default** (in `GalleryPreset` + `_PRESET_FIELDS`), promoted alongside `sets_enabled`.
- **Backend** — `CommentCreate.anchor` rides the existing comment endpoints (no new route).
  `comment_service.add_comment` logs an `"annotated"` activity verb (vs `"commented"`) and reuses the
  `comment` notification event (`meta.anchored`). Public `add_comment` rejects an anchor with `403`
  `CodedHTTPException(code="annotations_disabled")` unless `gallery.annotations_enabled`; **admin may
  always annotate** (photographer tool). Rule: **annotations require comments** (an annotation is a
  comment).
- **Frontend** — `components/gallery/AnnotationLayer.tsx` overlays the rendered `<img>` (measures the
  content rect via `getBoundingClientRect` + `ResizeObserver`, robust to `object-contain`
  letterboxing). Drawing mode captures a pointer-drag into a sampled point path (≥`SAMPLE_DIST`
  apart) → freehand stroke → inline note popover (edge-aware placement: flips above / clamps sideways
  near edges). Marks render in an SVG (`viewBox 0 0 100 100`, `vector-effect=non-scaling-stroke`):
  freehand polylines, legacy `rect`/`pin`. Each mark gets a **numbered badge** at its origin; the
  number map (anchored comments by creation order) is computed once in `Lightbox` and shared with
  `CommentPanel` so a stroke's number matches its comment row. **Bidirectional hover** (`hoveredAnno`
  state in `Lightbox`): hovering a mark/badge highlights its comment row and vice-versa. `Lightbox`
  has the annotate (pen) toggle, loads comments itself (shared query key with `CommentPanel`, so marks
  show without the panel open), and gates entering draw mode on a reviewer name (`ReviewerNamePrompt`
  with annotation-specific copy + `useReviewerStore`). Live in the public collab lightbox (gated by
  `features.annotations`) and the admin in-gallery lightbox (always, via `adminGalleryId`). Settings:
  a live **Annotations** toggle nested under Comments in `ReviewFields` (disabled when Comments is
  off), as a first-class `ReviewValues`/preset field (promoted from a render-prop on 2026-06-15,
  together with `sets_enabled`).
- **Counts / badges** — `comment_count` includes anchored comments; `annotation_count` (new on
  `ImageResponse`) counts only anchored ones (`comment_repo.anchored_counts_for_images`, via
  `json_extract(anchor,'$.type')` so a stored JSON `null` isn't miscounted — `Comment.anchor` is
  `JSON(none_as_null=True)`). Tiles show two badges: a pen (annotations) + a bubble (plain comments =
  `comment_count − annotation_count`), in `admin-grid-tile.tsx` and public `PhotoGrid`.
- **Visibility** — annotations are **hidden by default** in the lightbox; a `Spline`+count toggle
  reveals them (`showAnnotations`), and entering draw mode force-shows. `AnnotationLayer` gates saved
  marks on a `showMarks` prop.
- **Delete** — admin may delete any comment/annotation (`DELETE
  /api/galleries/{id}/images/{image_id}/comments/{comment_id}`); a public viewer only their own
  (`DELETE /api/public/g/{token}/…?reviewer=`, author-name match, else 403). `comment_service`
  `delete_comment` enforces it; trash button in `CommentPanel` (shown per `canDelete`, confirmed via
  the shared `<ConfirmDialog>`).
- **Edit** — **admin-only** (text only; author + anchor immutable). `PATCH
  /api/galleries/{id}/images/{image_id}/comments/{comment_id}` (`CommentUpdate{text}` →
  `comment_service.edit_comment` → `comment_repo.update_text`); no public endpoint. Inline edit in
  `CommentPanel` (pencil = `Icons.rename`, shown when `adminGalleryId` is set), so admins can also fix
  an annotation's note from the comment list. No migration, no "edited" indicator (deliberate).
- **Notifications** — a distinct **`annotation`** event (`NotificationEvents.annotation`, in
  `EVENT_KEYS` + the flush summary with a ✏️ line); `comment_service` enqueues `annotation` vs
  `comment` based on the anchor. Toggle in `/admin/settings/notifications`.
- **Follow-ups** (out of scope): arrow/shape tools, stroke smoothing, edit/move an existing anchor,
  resolve/done state, video annotations, presentation-mode annotations, burned-in export.

## IPTC metadata display

Architecture doc: `docs/architecture/iptc-display.md` (implemented 2026-06-15). Migration `0028`.
Activates the previously-scaffolded per-gallery `show_iptc` toggle and **scraps** the never-built
contact-sheet feature. Mirrors the existing EXIF display end-to-end.

- **Extract** — `_extract_iptc` in `app/tasks/image_processing.py` reads legacy IPTC-IIM via Pillow's
  `IptcImagePlugin.getiptcinfo` at upload (images only; videos skip the pipeline). Focused IIM field
  set (record 2): title (2,5), headline (2,105), description/caption (2,120), keywords (2,25,
  repeatable → list), creator (2,80), copyright (2,116), credit (2,110), city/state/country
  (2,90/95/101). UTF-8 decode w/ latin-1 fallback, blanks dropped, `try/except` like EXIF. Reads only
  IIM, not XMP (Lightroom/PS still write IIM alongside).
- **Store** — `images.iptc_data` TEXT (JSON), set in `update_processing_result` alongside `exif_data`.
  No auto-backfill — only newly-uploaded images get IPTC.
- **API** — `ImageResponse.iptc_data: dict | None`, parsed from JSON in `image_service._image_to_response`.
- **Render** — `Lightbox` has its own `showIptc` toolbar toggle (`Tags` icon, shown when the gallery
  enables it and the image has IPTC) + a labeled panel beneath EXIF (independent of the EXIF toggle).
  `GalleryView` passes `showIptc={gallery.show_iptc}`; the admin in-gallery lightbox always shows it.
- **Settings** — `show_iptc` is a live `LookValues` toggle (`gallery-settings-fields.tsx` `LookFields`,
  with `iptcHint`) and joins `GalleryPreset` (carries like `show_exif`). The old `comingSoon`
  scaffolding (contact sheet + IPTC placeholders) is gone.
- **Scrapped contact sheet** — `galleries.contact_sheet_enabled` dropped (model, schemas, cascade
  field list, frontend type, settings toggle). Not deferred — removed.

## Real-time updates (WebSocket) — Phase 3 Feature 9

Architecture doc: `docs/architecture/realtime-updates.md` (implemented 2026-06-15). Live-pushes
gallery changes (comments/annotations, flags/likes, votes, collections, uploads) to every open
viewer, replacing poll-and-invalidate. **No DB change** (pure transport).

- **Thin signals, not data** — the socket carries `{type, gallery_id, image_id?}`; the client
  **invalidates** the matching React Query keys and refetches through the normal access-gated REST
  endpoints. No parallel serialization, no data leakage.
- **Backend** — `app/realtime/hub.py` `ConnectionHub` (rooms keyed by `gallery_id`) + sync
  `publish(gallery_id, type, **fields)` that marshals a broadcast onto the loop captured in
  `_lifespan` (`hub.bind_loop`). Never raises into the request (like `notification_service.enqueue`).
  WS routes in `app/routers/realtime.py`: `WS /api/ws/admin/galleries/{id}` (auth via the httponly
  admin **cookie** the same-origin handshake carries — validated like `get_current_admin`) and
  `WS /api/ws/public/g/{share_token}` (gallery JWT in `?token=` only when password-gated; browsers
  can't set WS auth headers). Unauthorized → handshake rejected (HTTP 403). `publish` is called next
  to the existing `activity_repo.log` emit sites: `comment_service` (comment/annotation add/edit/
  delete), `image_service` (public flag/like, admin update/move/delete/reorder → `image`), public
  vote route, `collection_service` (create/delete), and `process_image` on completion (uploads).
- **Frontend** — `src/lib/realtime.ts` (one reconnecting, ref-counted WS per gallery; backoff +
  heartbeat; dev connects directly to `:8000` since Next rewrites don't proxy WS upgrades, prod is
  same-origin) + `src/hooks/useGalleryRealtime.ts` (maps signals → invalidations), wired into
  `useGalleryView` (public) and `useGalleryDetail` (admin). The admin upload-processing 3 s poll
  stays as a local fallback.
- **nginx** — `location ^~ /api/ws/` with the HTTP/1.1 `Upgrade` headers, `proxy_buffering off`, and
  a 3600s read timeout.
- **Single-process by design** (same deliberate choice as the rate limiter / notification flusher,
  per `backend/start.sh`) — right for a self-hosted single-photographer app; multi-worker fan-out is
  explicitly **not** a goal. Best-effort delivery; a missed frame self-heals on the next action/reconnect.

## Likes vs team voting (Review settings)

Three independent Review-mode toggles, easy to confuse (`gallery-settings-fields.tsx` `ReviewFields`):
- **Color flags** (`color_flags_enabled`) — one **shared** flag per photo (`Image.color_flag`); anyone
  overwrites it.
- **Likes** (`likes_enabled`) — per-reviewer heart, **one like per person** (`image_likes`, migration
  `0034`), count shown. (The label was "Likes & voting" → corrected to just **"Likes"** since it only
  controls likes.)
- **Team voting** (`enable_team_voting`) — turns the flag UI into **per-reviewer** flags
  (`image_votes`); each named reviewer keeps their own independent set, summarised in the admin Voting
  dialog. **Depends on Color flags** (the flag UI is gated on `features.colorFlags` in `PhotoGrid`/
  `Lightbox`), so the toggle is nested under + disabled without it (mirrors Annotations → Comments);
  with team voting on, likes are hidden (`showLikes = features.likes && !teamVoting`).

## Gallery settings autosave (hybrid)

Architecture doc: `docs/architecture/gallery-settings-autosave.md` (implemented 2026-06-16).
`GallerySettingsModal` no longer has a Save/Cancel — look & behaviour controls save **immediately**
(toggles/selects on change, text/date fields on blur, empty name skipped), with a `SaveStatus`
chip ("Saving…/Saved"); closing the modal = done.

- **Hook** — `src/hooks/useGallerySettingsAutosave.ts` (gallery-scoped sibling of
  `useSettingsAutosave`): `save(patch)` PATCHes a partial `GalleryUpdate`, optimistically merges into
  `["gallery", id]` (password stripped from the cache merge). **Selective tree invalidation** — only
  refetch `["galleries"]` when the patch touches `name`/`mode`/`pinned` (or a cascade); look/behaviour
  toggles skip the tree refetch entirely (the real cost).
- **Explicit, not autosaved** — the `apply_to_subgalleries` **cascade** (a footer button re-applying
  current look+behaviour to children in one PATCH) and the **password** ("Set" button) stay deliberate
  actions, never part of an autosave patch. The rename dialog still uses the page's `updateMutation`.

## Installable PWA & branding-aware icons

Architecture docs: `docs/architecture/pwa-installable-polish.md` +
`docs/architecture/branding-aware-favicon.md` (both 2026-06-16; the second supersedes the static-icon
delivery of the first). Installable web app (manifest + home-screen icon + theme color + standalone),
**no service worker / offline** (deliberate — image-/realtime-backed, poor ROI).

- **Icons are backend-rendered from branding** — `app/services/branding_icon.py` (Pillow) renders the
  favicon / app icons via the chain **uploaded logo → monogram (instance_name initial on
  `brand_color ?? accent_color`) → contact-sheet default** (a 3×3 frame grid, one amber accent frame;
  shown on a fresh install where the name is still "ContactSheet"). In-process cache keyed on a
  branding **signature** (logo+mtime+name+accent+brand_color) that doubles as the HTTP **ETag**, so a
  branding change invalidates browsers automatically.
- **Routes** — `app/routers/branding_icon.py`, **public**, under **`/api/branding/`** (not
  `/branding/`, a StaticFiles mount): `favicon.ico`, `icon-192.png`, `icon-512.png`,
  `icon-maskable.png`, `apple-touch-icon.png`, and **`manifest.webmanifest`** (served here so
  `theme_color` can derive from `accent_color` — `branding_icon.theme_color(s)`; `background_color`
  stays dark). `If-None-Match` → 304, `Cache-Control: max-age=300, must-revalidate`.
- **Frontend** — `layout.tsx` `metadata.manifest`/`icons` + `viewport.themeColor` point at
  `/api/branding/*`; the HTML `<meta name="theme-color">` stays static dark (immersive mobile chrome —
  only the installed-app manifest colour follows branding). No static icon assets / `manifest.ts` in
  the frontend; rendering lives entirely in the backend. No migration (reuses branding columns).
