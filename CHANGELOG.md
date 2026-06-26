<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

All notable changes to ContactSheet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.2] - 2026-06-26

### Fixed

- **"Remember me" now actually keeps you signed in.** The admin login flag was stored in
  `sessionStorage`, which the browser clears when the app or tab is closed — so on the next
  launch the admin area redirected to the login page *before* checking the still-valid 30-day
  session cookie. The flag now lives in `localStorage`, so a ticked "Remember me" survives an
  app restart (notably on iOS/iPadOS/macOS Safari, which fully close apps often). The server
  cookie remains the source of truth, so sign-out and session expiry are unaffected.

## [1.3.1] - 2026-06-26

### Fixed

- **Folder breadcrumb in collaboration galleries.** Nested sub-galleries in collaboration
  (voting) mode now show the full ancestor breadcrumb above the photo grid — the same
  `Parent › … › Current › child` trail presentation galleries already had. Previously the
  collaboration view only offered a one-level "up to parent" link, leaving clients in deeply
  nested galleries without orientation.
- **Notifications settings page no longer drifts sideways on mobile.**

## [1.3.0] - 2026-06-26

### Added

- **Full-instance backup & restore.** A new **Settings → Workspace** section builds a complete
  backup — the database plus uploads, branding, and watermarks — as a single archive you can
  download, and restores one back in place. Backups run as an async job (like ZIP export); restore
  is available both in the browser and via a CLI (`python -m app.restore <archive>`) for large
  instances. The database is captured with `VACUUM INTO` (never the live WAL), media is copied
  before the snapshot, a manifest records integrity and the schema revision, and restore refuses an
  archive from a *newer* build and keeps a rollback copy. Archives are plaintext — the UI warns, as
  they contain the password hash and secret key. See `docs/backup-and-restore.md`.
- **Photographer analytics.** A new **Analytics** dashboard (per-gallery in the Insights dialog and
  an instance-wide rollup at `/admin/analytics`) charts views, downloads, and engagement
  (flags, likes, ratings, votes, comments, annotations) over 7/30/90 days, with a "busiest
  galleries" / "top photos" breakdown. It's a pure read-model over existing activity — no new
  tracking. View counts appear only when activity IP logging is enabled; otherwise the dashboard
  says so rather than showing a fake zero. Timeseries bars use the instance accent colour.
- **Structured logging, request IDs & deep health checks.** Opt-in JSON logging (`LOG_FORMAT=json`),
  a per-request `X-Request-ID` correlation header, and an optional Sentry integration
  (`SENTRY_DSN`, PII-scrubbed, off unless set). Health is split into `GET /api/health` (liveness +
  version) and `GET /api/health/ready` (per-component database / migrations / storage / ML sidecar).
- **"Rebuild previews" maintenance action.** A button under Workspace regenerates all thumbnail and
  medium renditions from the originals — handy after a restore or a format-support change.
- **Optional `sqlite-vec` search backend.** For very large libraries (100k+ photos), an opt-in
  (`SEMANTIC_SEARCH_VEC`) C-accelerated vector index serves instance-wide semantic search; the
  default NumPy path and the SQLite source-of-truth table are unchanged. Off by default.

### Changed

- **Settings reorganized.** The settings navigation is regrouped into four coherent sections —
  Branding, Client Galleries, Workspace, and System — instead of one long list.
- **Smoother large galleries.** The admin and client photo grids are now window-virtualized, so
  galleries with thousands of photos scroll without the browser straining to render every tile.
- **Star-rating filter chips** were restyled to match the colour-flag chips — a gold star on a
  neutral chip rather than an amber fill.

### Fixed

- **UTC-aware API timestamps.** All model datetimes now round-trip as timezone-aware UTC, so the API
  serializes an explicit offset (`Z`). SQLite previously read them back naive, which some clients
  misparsed as local time.
- **Steadier toolbar.** The filter/sort/group bar no longer shifts when a filter becomes active, the
  admin search-mode layout is stable, and the "Filter & sort" count is floated so it can't shove the
  filter chips. The comment-filter active state is clearer, and flag/star chips are shown inline in
  the admin toolbar.
- **Insights label.** The per-gallery toolbar trigger now reads "Insights" instead of the misleading
  "Activity log" (the dialog holds both Analytics and Activity tabs).

### Upgrade notes

- **Host-mounted `nginx.conf` — manual step for backup/restore.** Backup/restore moves
  multi-gigabyte archives, which would otherwise hit nginx's 1 MB body cap and 413/truncate. The
  bundled `nginx.conf` now includes the block below; if you run a **custom or host-mounted** nginx
  config, add it yourself (above the general `location /api/`) — pulling the new images alone won't
  update a host-mounted file. Without it, backup download and restore upload will fail.

  ```nginx
  location ~ ^/api/admin/settings/(backup|restore) {
      client_max_body_size 2g;
      proxy_request_buffering off;
      proxy_pass http://backend:8000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 1800s;
      proxy_send_timeout 1800s;
  }
  ```

- **Database migration 0040** (`backup_jobs`) applies automatically on container start
  (`alembic upgrade head` runs in the entrypoint). No manual action needed.
- New optional env vars — `LOG_FORMAT`/`LOG_LEVEL`, `SENTRY_DSN`, `SEMANTIC_SEARCH_VEC` — are all
  off/default unless set; existing deployments are unchanged.

## [1.2.3] - 2026-06-25

### Added

- **Batch rename selected photos.** Select multiple photos, then "Rename selected…" opens a dialog
  with three modes — sequential numbering, find & replace, and prefix/suffix — with a live
  before → after preview. File extensions are always preserved, so downloads stay valid.
- **Customisable notification text.** Notification settings gain editable per-event message
  templates plus a title template (placeholders like `{author}`, `{count}`, `{gallery}`); leaving a
  field blank keeps the built-in default, so existing setups are unchanged.
- **Gallery link in notifications.** A new "Include gallery link" toggle (on by default) appends the
  public gallery URL to each notification — emitted only when a Public Base URL is configured.

### Changed

- **Clearer upload wording.** The sidebar "Upload New Files" / cover "Upload New Image" buttons and
  the drag-and-drop zone copy were reworded ("Add Files", "Add Image", "Add photos & videos").

### Fixed

- **Mobile gallery header.** The download button now stacks below the gallery title on narrow
  screens instead of crowding it.

## [1.2.2] - 2026-06-24

### Added

- **Bulk-delete selected photos.** The gallery selection bar gains a "Delete selected" action, so
  Select all → delete is possible.
- **Delete annotations without leaving annotation mode.** Tap an annotation (its number badge or the
  stroke) to reveal its trash button while the pen is still active.
- **Native settings list on mobile.** `/admin/settings` now shows a tappable section list instead of
  jumping straight into Branding (which hid every other section behind the drawer); each section page
  has a "← Settings" back arrow. Desktop is unchanged.

### Fixed

- **WhatsApp link previews.** The Open Graph image is now a bounded variant (≤ 1200 px) served from a
  new side-effect-free `GET /api/public/g/{token}/og-image` endpoint, instead of the raw header —
  a multi-MB header made WhatsApp (which has a strict image-size cap) drop the preview while Telegram,
  Apple Mail and Instagram showed it. Existing oversized headers are covered retroactively.
- **Header/cover uploads over 1 MB.** nginx capped these admin uploads at the 1 MB server default
  (only photo uploads were raised); lifted to 12 MB. Header/cover images are now also resized
  server-side to a bounded JPEG (≤ 3840 px) on upload, and the "set header from a gallery image" path
  never copies a full-size original.
- **Custom short link is now copy-pasteable.** Saving a custom slug refreshes the "Current link" row
  immediately, so the new link can be copied from there.
- **Mobile annotation.** The whole page no longer pinch/double-tap-zooms while annotating, and the
  stroke-width tools no longer push Download/Fullscreen/Close off the screen edge.
- **A video can no longer be set as the gallery header** (it has no Pillow-readable rendition).
- **Suppressed a benign dev-only CSP nonce hydration warning** on the theme script.

### Changed

- **Pinned the Turbopack workspace root to the repo root** (dev only). A stray lockfile above the
  repo made `next dev` infer the home directory as root and scan all of it — minutes-long route
  compiles and Node OOMs. Compiles drop back to ~15 ms.
- **Bounded the in-process og:image cache** (FIFO, 256 entries).

### Upgrade notes

- **The WhatsApp / og:image fix needs no nginx changes.** It ships in the backend image and is served
  through the existing `/api/` proxy, so a normal `docker compose pull` + `docker compose up -d` is
  enough for link previews to start working (existing oversized headers included).
- **The header/cover upload size fix requires updating the host-mounted `nginx.conf` *and* reloading
  nginx.** The file is bind-mounted from the host, so an image pull doesn't deliver it — copy the new
  `nginx.conf` next to your `docker-compose.yml`, then run **`docker compose restart nginx`**. Note
  that `docker compose up -d` alone does **not** reload it: Compose only recreates the nginx container
  when the service definition changes, not when the mounted file's contents change. Without the
  restart, header/cover uploads over 1 MB keep returning 413.

## [1.2.1] - 2026-06-24

### Security

- **Backend dependencies updated to clear known CVEs.** PyJWT 2.10.1 → 2.13.0, python-multipart
  0.0.18 → 0.0.31, Pillow 11.0.0 → 12.2.0, and FastAPI 0.115.6 → 0.138.0 (Starlette pinned to 1.3.1).
  `pip-audit` now reports zero known vulnerabilities across the backend. No behaviour change — image
  processing, EXIF extraction, authentication, uploads, watermarking, streaming ZIP downloads and the
  realtime WebSocket were all verified end-to-end against a freshly built stack.
- **Longer share-link tokens.** Newly created galleries now use 12-character share tokens (~62 bits of
  entropy) instead of 8, so an unlisted gallery URL can't be feasibly enumerated. **Existing share
  links are unaffected and keep working** — only generation changed.
- **Content-Security-Policy on the app.** The bundled nginx now sends a CSP header (alongside the
  existing X-Frame-Options / nosniff / Referrer-Policy), restricting the app to same-origin scripts,
  styles, images and connections (including the realtime WebSocket) and blocking framing — defense in
  depth against content injection.

### Added

- **Automated dependency scanning in CI.** A new workflow runs `pip-audit` (backend) and `npm audit`
  (frontend) on a weekly schedule and whenever a dependency manifest changes, so a CVE published
  against a pinned version surfaces without waiting for a code change.

### Fixed

- **Link previews now work out of the box on a standard deploy.** When `BACKEND_INTERNAL_URL` is
  unset, the frontend now defaults to the compose service name (`http://backend:8000`) in production
  instead of `localhost:8000` (which can never reach the backend from inside the frontend container).
  This silently broke link-preview unfurls for anyone who upgraded to 1.2.0 while keeping an older
  `docker-compose.yml`. **Upgrading from < 1.2.0:** if you maintain your own `docker-compose.yml`,
  either pull the latest one or add `BACKEND_INTERNAL_URL: "http://backend:8000"` to the `frontend`
  service's `environment:` (only needed if your backend service is named something other than
  `backend`).

## [1.2.0] - 2026-06-23

### Added

- **Star ratings as an alternative to color flags.** A new instance-wide **Rating style** setting
  (Settings → Gallery Defaults) switches every gallery between color flags and classic **1–5 stars** —
  one or the other, never both. Stars work everywhere flags did: the grid tiles, the lightbox, the
  filter/group/sort toolbar, and per-reviewer team voting. Switching is **non-destructive** — flags and
  stars are stored separately and neither is converted or cleared, so you can flip back and forth without
  losing any review work.
- **Link previews for shared galleries (Open Graph).** Pasting a gallery share link into iMessage,
  WhatsApp, Slack, Discord, and the like now unfurls a rich preview with the gallery's name and cover
  image (Open Graph + Twitter summary card). Password-protected galleries reveal the name but never the
  cover. The preview is built from a dedicated, side-effect-free metadata endpoint, so a link-scraper
  unfurl never counts as a client view or fires a notification.
- **Instant gallery downloads — no "preparing ZIP" wait.** "Download all" and filtered selections now
  stream the ZIP on the fly, with a real browser progress bar and no server-side prepare/poll step —
  the archive starts downloading immediately and its size is known up front.
- **Title position over the header image.** Presentation galleries can now anchor the gallery title to
  any of nine positions over the full-screen hero (top-left … bottom-right) via a 3×3 picker in the
  gallery's Look settings. Defaults to centered, exactly as before.
- **Download filename lists as a file (.txt / .csv) for Lightroom & co.** The "Copy filenames" dialog
  now offers a **Download** button alongside Copy: a plain `.txt` list (paste into Lightroom's Filename
  filter, Capture One, Photo Mechanic) or a `.csv` review sheet with one row per photo
  (`filename, rating, flag, likes, comments`) that opens in Excel/Sheets. Files are named after the
  gallery; the CSV carries a UTF-8 BOM so umlauts render correctly.
- **Include subgalleries when exporting filenames.** A new toggle in the same dialog folds in every
  photo from nested galleries (recursively), with the current filters applied across the whole tree —
  so "all selects" can span an entire gallery subtree in one export. Suppressed for collection and
  search views, which are per-gallery.

### Changed

- **Faster ZIP downloads.** Original photos are now stored uncompressed (`ZIP_STORED`) in the archive
  instead of DEFLATE — they're already-compressed JPEG/RAW/video, so compressing them again only burned
  CPU. Downloads start sooner and carry an exact `Content-Length`.

### Fixed

- **Annotations are drawable again in the lightbox.** The photo was painting on top of the annotation
  layer, so freehand drawing did nothing (the drag toggled immersive mode instead) and saved marks
  couldn't be clicked. The layer now sits above the photo and receives pointer events.
- **Color flag set in the lightbox now shows on the thumbnail immediately.** Flagging a photo in the
  lightbox and closing it left the grid thumbnail showing the old flag until a page refresh; the tile
  now adopts the change live (also fixes the same lag for flags set by another reviewer).

## [1.1.4] - 2026-06-22

### Fixed

- **Content Search status now tells "reachable" apart from "model loaded."** The ML-service badge
  read "online" whenever the sidecar answered its health check — even when the model failed to load
  and every image was failing to index. It now shows **"reachable, model not loaded"** with a hint
  (check the sidecar logs; often an unwritable model-cache dir) when the service is up but indexing
  is erroring, so this case diagnoses itself.
- **Lightbox: images keep a consistent bottom margin in showcase mode.** With the caption/filename
  off, the photo ran to the bottom edge; the footer row is now always reserved so the image has the
  same bottom margin whether or not a caption is shown.

## [1.1.3] - 2026-06-22

### Added

- **Infinite scroll on the All Photos view.** Scrolling near the end now loads the next page
  automatically; the "Load more" button stays as a fallback.

### Fixed

- **Content search: self-healing model-cache permissions.** When `data/ml-cache` was created as root
  (a common Docker bind-mount default), the ML sidecar (UID 1001) couldn't download the model, so
  **every** image failed to index while the service still showed "online". The sidecar now fixes the
  cache ownership on startup and drops privileges — mirroring how the backend already heals `/data`.
  Affected operators just `docker compose pull && docker compose up -d`.
- **Client (visitor) uploads were capped at 1 MB by the bundled nginx**, returning 413 for any real
  photo. The public upload path now shares the same large body-size limit as the admin upload.

### Deployment / upgrade notes

- If you run an **extra reverse proxy in front of the bundled nginx** (e.g. an HTTPS terminator),
  set `TRUSTED_PROXY_HOPS=2` in `.env` so rate limiting and the activity log record the real client
  IP instead of the proxy's. Default `1` covers the bundled nginx only.

## [1.1.2] - 2026-06-22

### Added

- **Photoshop PSB support.** Upload `.psb` (large-document) files. When the file carries an embedded
  preview (saved with *Maximize Compatibility*) it shows a normal thumbnail; otherwise it appears as
  a download-only tile and the original downloads intact. No heavy decoder — the preview is read
  straight from the file's embedded thumbnail, so it stays fast even on multi-GB files.

### Fixed

- The upload drop-zone hint still read "JPEG, PNG, WebP up to 200 MB" — it now lists the formats and
  limit added in 1.1.1 (TIFF, PSD, PSB & RAW, up to 300 MB).

### Notes & limitations

- PSB previews depend on the embedded thumbnail (small if Photoshop saved a small one), and PSB is
  excluded from content search. Very large PSB still respect the upload size limit (`MAX_UPLOAD_BYTES`).

## [1.1.1] - 2026-06-22

### Added

- **Broad file-format support.** Upload **TIFF, PSD, and camera RAW** (CR2, CR3, NEF, ARW, RAF, ORF,
  RW2, DNG, and more) alongside JPEG/PNG/WebP. Your original files are stored and downloaded
  untouched; the gallery, lightbox, and ZIP exports use generated JPEG previews. Content search
  indexes the new formats too.

### Fixed

- **Notifications: the "Add channel" button did nothing** when the admin was served over plain HTTP
  (a LAN IP or an HTTP-only reverse proxy). It depended on a browser API (`crypto.randomUUID`) that
  exists only on HTTPS/localhost; it now works on insecure origins.
- **Copying a share link and copying filenames** silently failed over plain HTTP for the same reason
  (`navigator.clipboard`); both now fall back so they work without HTTPS.

### Notes & limitations

- **RAW previews use the camera's embedded JPEG** (no demosaic — this keeps the app lean and fast).
  Modern cameras embed a full-resolution preview; some older compacts embed only a small one,
  yielding a lower-res preview. The original RAW always downloads intact.
- **PSD** renders its flattened composite (save with *Maximize Compatibility*); layers aren't read.
  **PSB** (large-document) isn't supported yet. **Video is still never transcoded** (unchanged).
- Default per-file upload limit raised from 200 MB to **300 MB** (configurable via `MAX_UPLOAD_BYTES`).

### Deployment / upgrade notes

- **Nothing to do — no new services and no database migration.** The backend image gains one small,
  self-contained RAW-preview dependency (`rawpy`); just `docker compose pull && docker compose up -d`.

## [1.1.0] - 2026-06-22

### Added

- **Content search (optional).** Find photos by what's *in* them ("car at sunset", "team photo with
  trophy") — within a gallery, or across the whole library from the new **All Photos** view. It runs
  on an on-device, multilingual AI model (SigLIP 2); nothing leaves your server. Enable it under
  **Settings → Content Search**, with an accuracy slider and a live index-progress readout.
- **All Photos** — a cross-gallery photo browser on the overview (a tab next to *Galleries*), sorted
  by date or name, paginated. Its search box runs semantic search when content search is on, and
  otherwise filters by **filename, gallery name, and IPTC metadata** (keywords, caption, title,
  location, creator) — so it's useful even without the AI model. Results badge their gallery and
  deep-link straight into its lightbox.

### Deployment / upgrade notes

- **Nothing changes for an existing deployment unless you opt in.** The semantic-search model runs
  in a **separate, optional `ml` sidecar** that the default stack never starts. A new migration
  (`0037`) applies automatically on upgrade and is inert until the feature is enabled.
- To turn it on: `docker compose --profile ml up -d` and set `ML_SERVICE_URL=http://ml:8001` in
  `.env`, then enable it under Settings → Content Search. The model (~a few hundred MB) downloads
  once into the data volume on first use.
- The sidecar is CPU-only (no GPU needed) and intended to stay light, but it does add load — on a
  low-power host you can simply leave it off. When it isn't deployed, Settings → Content Search
  detects this and explains how to start it instead of offering a toggle that can't work.

## [1.0.6] - 2026-06-21

### Added

- **Move gallery** — relocate a whole gallery, with its sub-galleries, to another parent or to the
  top level. A picker in the gallery's menu (⋯ → Move gallery) mirrors the move-images dialog, marks
  the current parent, and excludes the gallery's own subtree to prevent cycles.

### Changed

- The admin gallery detail page now adapts to what's inside: a **container** (sub-galleries, no own
  photos) leads with its sub-galleries and lets the photo tools recede, instead of opening to an
  empty grid; leaf and mixed galleries stay photo-first.
- Reorganising galleries by drag is **always on** — the "Organize" toggle is gone. Drag a gallery
  onto another to nest it, or onto the permanent "move to top level" strip above the grid to pull it
  out. A reparent shows an Undo. Drag is disabled on touch (where the Move gallery dialog is the
  reliable path).

## [1.0.5] - 2026-06-20

### Changed

- The mobile filter/sort/group toolbar in the review and admin gallery views no longer occupies
  three sticky rows. It now stays a single row — filename search plus a **Filter & sort** button
  that opens a bottom sheet holding the flag/comment filters, sort and grouping.
- On a phone, the admin gallery detail page merges the "go up" link into the top bar (in place of
  the global brand) instead of stacking a second navigation row below it.
- The header/cover image buttons on the admin gallery page now appear only for an empty gallery;
  once it has photos, those actions live in the sidebar menu so the canvas opens straight to the
  grid.

### Fixed

- On touch devices the per-photo collaboration controls (flag picker, like, download, comment) were
  rendered permanently over every thumbnail (no hover to reveal them), obscuring the photo. The grid
  now shows only resting indicators — the active flag dot and comment badge — and flagging or
  commenting happens in the lightbox.

## [1.0.4] - 2026-06-18

### Changed

- Loading states across the admin settings pages and the gallery detail view now show skeleton
  placeholders instead of a bare "loading…" line, so the layout no longer jumps when content
  arrives.
- The empty filter result now offers a **clear filters** action.

### Fixed

- Accessibility: visible focus rings on controls that previously showed none (footer settings
  inputs, the public footer's social links, the annotation editor), `aria-label`s on icon-only
  buttons, and the OS "reduce motion" preference is now honored everywhere (lightbox swipe, drawers,
  dialogs, spinners).
- The public footer's social links now meet the 44px touch-target size and respond to tap/focus
  rather than hover-only.
- Lifted low-contrast muted text in the public gallery and admin to clear WCAG AA.
- The photo grid no longer reflows as lazy-loaded images arrive in list view — each tile reserves
  its height up front.

## [1.0.3] - 2026-06-18

### Fixed

- **Delete** and **Rename** in the gallery overview's card menu navigated into the gallery instead
  of opening their dialog. The menu is portalled in the DOM but still a React child of the card, so
  item clicks bubbled up the React tree to the card's open handler; they're now stopped at the menu.

## [1.0.2] - 2026-06-18

### Added

- Sub-galleries can be created directly in **Showcase** or **Review** mode — the create dialog now
  has a mode selector, pre-filled with the parent gallery's mode.
- Selected photos can be moved into another gallery in bulk: a **Move to gallery** action in the
  selection bar, plus drag-and-drop of the whole selection onto sidebar galleries and sub-gallery
  cards (with an undoable confirmation).

### Changed

- The **Capture Date** sort option now appears only when at least one photo in the gallery carries
  EXIF capture metadata; without it the sort falls back to filename so the order stays meaningful.

### Fixed

- A Showcase sub-gallery of a Review gallery was stuck in the review (sidebar) layout regardless of
  its own mode. Sub-galleries now follow their own mode.
- Public gallery dialogs (save collection, reviewer name, client upload, download) used a fixed
  dark or light surface instead of following the gallery's tone — they now adapt to the bright/dark
  setting. The download dialog, which is shared with the admin, also tracks the admin theme.

## [1.0.1] - 2026-06-18

### Added

- The login screen now shows the instance's branding logo, falling back to the ContactSheet
  default mark.

### Fixed

- Copy filenames, the flagged-selection text export, and ZIP downloads no longer leak the folder
  path for photos added via a folder (drag-and-drop) upload. Uploads now store only the base
  filename, and the existing consumers strip any leftover path from older rows.
- Dragging a photo while a non-manual sort (by date, name, etc.) was active could silently move it
  out into the parent gallery. Reparenting now only happens on a deliberate drop onto a gallery
  card or nav folder; an image dropped in empty space simply stays put.

### Changed

- The default source-code URL (the AGPL §13 "source" link) now points at the public GitHub
  repository.
- Neutral, professional example text across admin UI placeholders and the documentation.

### Demo & documentation

- Added a reproducible demo instance (seed scripts + asset manifest) and refreshed all
  documentation screenshots.
- Demo photos now use Lorem Picsum imagery, and the showcase demo gallery gained a full-width
  hero banner.

## [1.0.0] - 2026-06-17

Initial public release. ContactSheet is a self-hosted photo delivery platform for photographers —
share private client galleries, collect feedback, and deliver finals. The REST API and share-link
contract are considered stable as of this release.

### Galleries & delivery

- Nested galleries (unlimited depth) with shareable links and two modes: **Showcase**
  (presentation) and **Review** (collaboration).
- Customizable share slugs, optional per-gallery passwords, and expiry dates.
- Per-gallery look & behaviour — layout, preview size/spacing/corners, opener typography,
  backgrounds — with instance-wide mode presets and autosaving settings.

### Client collaboration

- Color flags, per-person likes, comments, and team voting.
- Freehand **annotations** anchored to a photo (each is a comment with a spatial mark).
- Saved **collections** (named image sets), editable by their creator or the admin.
- **Client uploads** with an optional approval/moderation queue.

### Media

- Image upload and processing (thumb/small/medium renditions; EXIF + IPTC extraction).
- Browser-native **video** (MP4/MOV/WebM) served as-is, no transcoding.
- Image and text **watermarks**, composited on the fly and cached.
- **ZIP export** — whole gallery, a filtered selection, or multiple galleries — as background jobs.

### Branding & experience

- Instance and gallery **branding**: studio name, logo, accent color, masthead fonts, public footer.
- Installable **PWA** with a branding-aware app icon.
- **Internationalization** (English + German), Weblate-backed.
- Mobile-responsive admin and client surfaces; a touch lightbox with swipe gestures.
- **Real-time updates** over WebSocket.

### Notifications

- Pluggable channels via **Apprise** (email, Pushover, Discord, ntfy, Telegram, Slack, custom),
  with an outbox + coalescing flusher and an opt-in SSRF guard.

### Security & operations

- Stateless admin JWT (httponly, `SameSite=strict`, auto-`Secure` over HTTPS), "sign out
  everywhere", a first-run setup wizard, and a guarded factory reset.
- Per-IP rate limiting on auth and every public write, derived from a configurable number of
  trusted proxy hops (`TRUSTED_PROXY_HOPS`).
- Path-traversal-safe storage, magic-byte upload validation, and decompression-bomb / pixel-area
  caps (stricter for public uploads).
- Docker Compose deployment (backend + frontend + nginx); SQLite + local filesystem.

[Unreleased]: https://github.com/nielsfranke/contactsheet/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/nielsfranke/contactsheet/compare/v1.2.3...v1.3.0
[1.2.3]: https://github.com/nielsfranke/contactsheet/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/nielsfranke/contactsheet/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/nielsfranke/contactsheet/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/nielsfranke/contactsheet/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/nielsfranke/contactsheet/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/nielsfranke/contactsheet/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/nielsfranke/contactsheet/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/nielsfranke/contactsheet/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/nielsfranke/contactsheet/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/nielsfranke/contactsheet/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/nielsfranke/contactsheet/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/nielsfranke/contactsheet/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/nielsfranke/contactsheet/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/nielsfranke/contactsheet/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/nielsfranke/contactsheet/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nielsfranke/contactsheet/releases/tag/v1.0.0
