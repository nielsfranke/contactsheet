<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

All notable changes to ContactSheet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Impressum and privacy pages.** Two new free-text fields (**Settings → General → Legal pages**)
  publish an imprint at `/impressum` and a privacy policy at `/privacy`, linked from the bottom of
  every client gallery. Leave a field empty and its link disappears and the page 404s. The text is
  rendered as plain text with your line breaks preserved — never as HTML.
- **A "Support" link for the ContactSheet project**, in the same footer strip. It is **on for new
  installations and stays off for instances that already exist**, so an upgrade never adds a
  donation link to galleries you have already delivered. Toggle it under Settings → General.

### Fixed

- **The AGPL source link is now actually shown to clients.** `Settings → General → Source URL` was
  stored and editable but rendered on no public page — AGPL §13 requires offering the running
  source to *network users* (your clients), not just to the admin. Every public gallery now carries
  a "Source" link in the new footer strip. It is deliberately **not** hidden by the
  branding-footer toggle, and it points at your custom source URL when a fork sets one.

## [1.8.1] - 2026-07-08

### Fixed

- **The “auto-fill header” switch (Settings → Gallery defaults → Viewing) now stays on.** It saved
  correctly but the settings API never echoed the value back, so the toggle flipped on and then
  immediately snapped off again. The feature itself was unaffected — only the switch was stuck.
- **Dropping something that isn’t an image file onto the header/cover drop zone now shows a clear
  hint** instead of a raw “field required” error. To reuse a photo already in the gallery, use its
  “Set as header/cover” action (or the cover dialog’s “choose a photo” grid) rather than dragging it
  onto the drop zone, which is for files from your computer.

## [1.8.0] - 2026-07-08

### Added

- **Optional auto-fill for the gallery header.** A new instance setting (**Settings → Gallery
  defaults → Viewing**, off by default) lets a gallery use one of its own photos for the opener when
  no header image is set by hand — so galleries look finished without manual work. The pick is
  stable per gallery (it won't change between visits or churn link previews) and deliberately differs
  from the cover, and it respects watermarks. A header you set manually always takes precedence. See
  `docs/proposals/auto-header-image.md`.

### Fixed

- **Dragging a photo onto the header/cover drop zone now works** instead of failing with an
  “[object Object]” error. A photo dragged from the browser arrives without a filename, which the
  server rejected as an invalid upload; the drop now always carries a filename, so the dragged photo
  becomes the header/cover as intended. Upload errors (e.g. a file over the 100 MB header limit) also
  render as readable messages now rather than “[object Object]”.

## [1.7.1] - 2026-07-08

### Fixed

- **Uploading a large folder no longer fails with a bare “Network error.”** The admin gallery upload
  used to send the entire drag-and-drop batch as a single request; a big folder (e.g. 105 × 50 MB ≈
  5 GB) then exceeded the request-body ceiling of a reverse proxy in front of the app and the whole
  batch was rejected before a single photo was saved. The batch is now split into byte-bounded
  (~256 MB) sub-requests that upload **sequentially**, so a folder of any size stays comfortably
  under any realistic proxy limit — no proxy reconfiguration needed. Photos appear in waves as each
  part completes, and if a later part fails the earlier ones are kept: the toast reports how many
  landed so you can retry only the remainder.
- **Photos above 100 MP now generate previews.** The per-image pixel ceiling was raised from 100 MP
  to **250 MP**, so high-end medium-format originals (e.g. 12000 × 9000 = 108 MP) and large panorama
  stitches are processed instead of failing rendition with an “exceeds pixel area limit” error and
  showing a broken thumbnail. Attacker-reachable client (public) uploads keep their stricter 50 MP
  cap. Env-overridable via `MAX_IMAGE_PIXELS` for memory-constrained hosts.

## [1.7.0] - 2026-07-08

### Added

- **Per-mode sub-gallery presets.** A container gallery can now hold a separate look & behaviour
  template for each mode — a Showcase template and a Review template — under **Gallery settings →
  General → “Sub-gallery defaults”**. New sub-galleries you create inside it start from the template
  that matches their mode, so a customer folder can mix Review sub-galleries (e.g. “Work in
  Progress”) and Showcase sub-galleries (e.g. “Final Deliveries”) without styling each one by hand.
  Templates are inherited down the whole folder tree and can be pushed to existing sub-galleries with
  “Apply to all sub-galleries”. See
  `docs/proposals/gallery-per-container-mode-presets.md`.

### Changed

- **“Apply to all sub-galleries” now reaches every nested level**, not just the direct children —
  in deeply nested folders, grandchildren and deeper previously never received the settings.
- **“Apply to all sub-galleries” no longer changes a sub-gallery’s mode.** Only look & behaviour are
  propagated now, so a folder can hold mixed Review and Showcase sub-galleries and applying settings
  won’t flip them all to the parent’s mode.
- **A sub-gallery created in a different mode than its parent now starts from the standard preset for
  that mode** (or the folder’s own template for it, if set) instead of inheriting the parent’s
  wrong-mode look.
- **Manually uploaded gallery header & cover images now allow up to 100 MB** (was ~10 MB), so
  full-resolution developed JPEGs can be used directly without shrinking them first. The server still
  bounds the stored image to 3840 px, so this only lifts the upload cap.

  **Operator action required:** the bundled `nginx.conf` is host-mounted, so pulling the new images
  alone does **not** raise the limit for header/cover uploads. Update `nginx.conf` on the host (its
  header/cover/watermark/logo location now uses `client_max_body_size 110m`) and recreate the nginx
  container; if a reverse proxy (e.g. Nginx Proxy Manager) sits in front, raise its body-size limit
  to ≥100 MB on those paths too.

## [1.6.9] - 2026-07-07

### Fixed

- **Public gallery images failed to load during a large upload.** Bulk-uploading many photos at once
  (e.g. via the Lightroom / Capture One plugins or another API client) could saturate the database
  connection pool: the admin UI's live-refetch storm, serialized rendition writes, and background
  semantic-search indexing all competed for a pool that defaulted to just 15 connections. Requests
  then timed out (`QueuePool limit ... reached`), so **both** the admin and the client (public) view
  degraded — broken thumbnails and full-size images — until the upload backlog drained. Three fixes:
  the connection pool is now sized for bursts (`DB_POOL_SIZE`/`DB_MAX_OVERFLOW`, env-tunable), the
  embedding worker no longer holds a pooled connection across its call to the ML sidecar, and the
  admin live-update refetches are coalesced so a burst of uploads no longer fans out into one refetch
  per photo. No configuration change is required to benefit.
  See `docs/architecture/db-connection-pool-under-bulk-upload.md`.

## [1.6.8] - 2026-07-07

### Changed

- **Photoshop (.psd/.psb) and TIFF uploads now allow up to 8 GB** (was 300 MB), configurable via
  `MAX_DOCUMENT_BYTES` — large layered working files upload without being rejected. Regular photos
  stay at 300 MB; client uploads keep their small cap.

  **Operator action required:** the bundled `nginx.conf` is host-mounted, so pulling the new images
  alone does **not** raise the limit. Update `nginx.conf` on the host (its `client_max_body_size` is
  now `8g`) and recreate the nginx container. If a reverse proxy fronts the stack (e.g. Nginx Proxy
  Manager), raise its upload/body-size limit to at least 8 GB there too, or it will reject first.

## [1.6.7] - 2026-07-07

### Fixed

- **Adobe RGB (wide-gamut) photos looked desaturated.** Previews were written straight from the
  source pixels with no colour profile, so an image exported in Adobe RGB (or ProPhoto / Display-P3)
  rendered washed-out — browsers assume sRGB for an untagged image. Renditions are now colour-managed
  to sRGB and tagged accordingly, so wide-gamut photos display with correct, saturated colour.
  Header, cover and link-preview images are converted too. Photos already uploaded are re-rendered
  automatically on the next restart; originals are never altered.

## [1.6.6] - 2026-07-07

### Added

- **Duplicate-filename upload resolution.** Uploading a photo whose filename already exists in
  the gallery now prompts how to proceed instead of silently adding a second copy: **Replace**
  (overwrite the existing photo in place — its comments, ratings, votes, collection membership
  and any pinned gallery cover are kept, so a re-uploaded cover follows automatically),
  **Keep both** (the new file is renamed `_v2` / `_v3`), or **Skip**. Choose once for the whole
  batch or per file. Third-party clients (Lightroom/Capture One personal-access-token uploads)
  are unaffected — without the new option they keep appending as before.

### Fixed

- **Moving photos between galleries dropped a preview size.** Moving (or copying) an image to
  another gallery relocated only some of its renditions, leaving the intermediate `small`
  preview behind in the old gallery — so thumbnails/previews could fail to load in the
  destination (notably on phones and with high-res previews on). All rendition sizes now follow
  the move, and the rendition worker is hardened so moving a photo mid-processing no longer
  strands its previews. Already-affected photos repair themselves automatically on upgrade.

## [1.6.5] - 2026-07-03

### Added

- **Rating style "Both" — color flags and stars together.** Settings → Gallery defaults →
  Rating style gains a third option that shows both systems side by side, Lightroom-style:
  flags for select/reject, stars for grading. Grid tiles stack the star picker above the
  flag dots on hover and combine the resting badge into one line; the lightbox toolbar
  shows both control groups; filters offer flag *and* star chips (combinable — they narrow
  together), grouping can bucket by flag or by rating, and sort-by-rating is available
  whenever stars are visible. Values stay independent and switching styles remains
  non-destructive — nothing is converted or cleared. Works with team voting: each reviewer
  keeps their own flag and star. No migration needed.

### Fixed

- **Star-filtered downloads exported the whole gallery.** With only a star filter active,
  "Download" in client galleries and the admin gallery view ignored the filter and fell
  through to the full export; both now download exactly the filtered photos.

## [1.6.1] - 2026-07-03

### Fixed

- **Settings: "Maximum zoom" options overflowed on phones.** The picker forced four
  columns, pushing "Original size" past the screen edge on narrow viewports; it now wraps
  to 2×2 on phones.

## [1.6.0] - 2026-07-03

### Added

- **Zoom in the Review lightbox (desktop).** A picdrop-style zoom control in the lightbox
  bottom toolbar — magnifier (reset), slider and live percentage — for Review galleries
  (including the client review-switch) and the admin gallery view; never in Showcase.
  Mouse-wheel / trackpad zoom anchors at the cursor, dragging pans the zoomed photo, and
  the arrow keys always change the photo (never the zoom), even with the slider focused.
  Annotating works while zoomed: the pen owns the drag, wheel and slider keep zooming, and
  strokes land exactly where drawn. Zooming uses the preview renditions — originals are
  never fetched, so download gating and watermarks are never bypassed.
- **Zoom is configurable** under Settings → Gallery defaults → Viewing: switch the control
  off entirely, or cap it at 200 % / 300 % / 400 % (relative to the fitted photo) or the
  photo's real 1:1 original size. Phone/tablet pinch-zoom is unaffected. (Migration 0044.)
- **The comment icon also reveals pen marks.** Opening the comment panel now shows any
  existing annotations on the photo along with their numbered comment rows; closing hides
  them again. The eye toggle keeps working standalone.

### Fixed

- **Even photo frame in the Showcase lightbox.** The filename strip at the bottom now
  matches the top toolbar's height when it is the only bottom chrome, so the photo sits
  vertically centered instead of hugging the bottom edge.
- Deactivating the annotation pen closes the comment panel it opened, mirroring the
  comment icon's toggle.

## [1.5.0] - 2026-07-02

### Added

- **Clients can switch a Showcase gallery into Review mode.** A new per-gallery opt-in
  ("Let clients switch to Review", off by default) shows a "Review photos" button beside the
  download button in the public gallery. It flips the gallery into the full Review experience —
  flags/ratings, likes, comments, collections, per the gallery's feedback toggles — without the
  photographer changing the gallery's mode for everyone; "Back to showcase" in the sidebar returns.
  The client's choice sticks for the session and follows them into sub-galleries. With the switch
  on, the gallery settings modal exposes the Review tab for Showcase galleries so the feedback
  tools can be configured, and the Showcase mode preset can enable the switch for new galleries
  by default. The setting cascades to sub-galleries like the other look & behaviour settings.

## [1.4.3] - 2026-07-02

### Fixed

- **Settings no longer overflow on mobile.** On narrow (<640px) screens several settings controls
  ran off the right edge: labelled rows now stack their control beneath the label instead of
  crushing it, the rating-style buttons (Color flags / Stars) stack full-width so the long label
  no longer clips, and the gallery-defaults preset modal (whose footer buttons blew the dialog past
  the viewport) now stacks its footer on mobile. Desktop layout is unchanged.

## [1.4.2] - 2026-06-30

### Added

- **Read client picks back into Lightroom.** A new `images:read` token scope and a narrow,
  gallery-scoped endpoint `GET /api/galleries/{id}/images/picks` (returning each image's color
  flag, star rating and like count) let the Lightroom plugin pull client picks back into the
  catalog as color labels / star ratings. The token-creation page gains an **Read client picks**
  permission toggle (off by default).

## [1.4.1] - 2026-06-30

### Changed

- **API tokens can now delete images.** `DELETE /api/images/{id}` accepts a personal access token
  with the `images:write` scope (previously admin-cookie only). This lets the Lightroom publish
  service replace an edited photo without leaving a duplicate, and remove a photo from a published
  collection. Gallery deletion stays admin-only.

## [1.4.0] - 2026-06-28

### Added

- **API tokens for third-party tools.** A new **Settings → API tokens** page lets you create scoped,
  revocable personal access tokens (`cs_pat_…`) so external tools can upload to your galleries
  without sharing your admin password. Each token is limited to gallery and image-upload
  permissions — never settings, reset, or account access — and shows up in the Publish flow of the
  new plugin below.
- **Capture One export plugin** *(macOS)*. Publish selected variants straight from Capture One into
  a gallery — pick or create a gallery (Showcase/Review), with editable export recipes — powered by
  the new API tokens. It's a separate, MIT-licensed add-on:
  [contactsheet-captureone](https://github.com/nielsfranke/contactsheet-captureone).

### Changed

- Dependency refresh (FastAPI, SQLAlchemy, Pydantic, React, and others) and a small internal
  cleanup — no behaviour change.

## [1.3.5] - 2026-06-27

### Fixed

- **Large galleries now load every photo on mobile.** In the admin gallery view, galleries with
  more than ~150 photos only rendered the first screenful — scrolling down revealed blank space
  where the rest of the grid should be, most noticeably on phones. The photo grid only keeps the
  on-screen rows mounted (for speed) and tracks the scroll position to know which rows those are;
  it was watching the browser window's scroll, but the admin screen scrolls an inner panel, so it
  never noticed you scrolling and never loaded the rows below the fold. It now follows whichever
  element actually scrolls. The public gallery, which scrolls the window, was unaffected. Verified
  end-to-end against a real mobile browser.

## [1.3.4] - 2026-06-27

### Fixed

- **Admins no longer forced to re-login on Safari (iPad & Mac).** Safari autocompletes to the
  last full URL it saw — typically `…/login` — so a returning admin landed straight on the login
  form. That page never checked for an existing session, so a still-valid cookie (and "Remember
  me") was ignored and the admin had to sign in again every visit. The login page now validates
  the session and redirects an already-signed-in admin to the dashboard. As a companion fix, the
  admin shell now treats the httponly cookie as the sole source of truth instead of a localStorage
  hint — WebKit's ITP evicts localStorage after ~7 days while leaving the cookie intact, which had
  bounced infrequent admins to the login screen. Verified end-to-end against the real browser.

## [1.3.3] - 2026-06-26

### Fixed

- **Admins now stay signed in on Safari (iPad & Mac).** Without "Remember me" the admin
  session cookie was a bare session cookie (no expiry). WebKit drops session cookies
  unreliably — between tabs, on backgrounding, under ITP — so admins were logged out on
  almost every visit and a fresh tab never carried the session. The cookie now always sets an
  explicit lifetime matching its token (30 days with "Remember me", 24 hours otherwise), so it
  survives tab switches and app restarts. Verified end-to-end against the real WebKit engine.
- **Overlapping toolbar on iPad portrait.** In Split View the admin galleries toolbar pinned a
  fixed height while its controls wrapped onto extra rows, so the sort buttons overlapped the
  "move to top level" drop zone below. The shelf now keeps its anchor height on one row but
  grows when the controls wrap.

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

[Unreleased]: https://github.com/nielsfranke/contactsheet/compare/v1.8.1...HEAD
[1.8.1]: https://github.com/nielsfranke/contactsheet/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/nielsfranke/contactsheet/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/nielsfranke/contactsheet/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/nielsfranke/contactsheet/compare/v1.6.9...v1.7.0
[1.6.9]: https://github.com/nielsfranke/contactsheet/compare/v1.6.8...v1.6.9
[1.6.8]: https://github.com/nielsfranke/contactsheet/compare/v1.6.7...v1.6.8
[1.6.7]: https://github.com/nielsfranke/contactsheet/compare/v1.6.6...v1.6.7
[1.6.6]: https://github.com/nielsfranke/contactsheet/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/nielsfranke/contactsheet/compare/v1.6.1...v1.6.5
[1.6.1]: https://github.com/nielsfranke/contactsheet/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/nielsfranke/contactsheet/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/nielsfranke/contactsheet/compare/v1.4.3...v1.5.0
[1.4.3]: https://github.com/nielsfranke/contactsheet/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/nielsfranke/contactsheet/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/nielsfranke/contactsheet/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/nielsfranke/contactsheet/compare/v1.3.5...v1.4.0
[1.3.5]: https://github.com/nielsfranke/contactsheet/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/nielsfranke/contactsheet/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/nielsfranke/contactsheet/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/nielsfranke/contactsheet/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/nielsfranke/contactsheet/compare/v1.3.0...v1.3.1
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
