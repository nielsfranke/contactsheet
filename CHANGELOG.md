<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

All notable changes to ContactSheet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.4] - 2026-06-22

### Fixed

- **Content Search status now tells "reachable" apart from "model loaded."** The ML-service badge
  read "online" whenever the sidecar answered its health check — even when the model failed to load
  and every image was failing to index. It now shows **"reachable, model not loaded"** with a hint
  (check the sidecar logs; often an unwritable model-cache dir) when the service is up but indexing
  is erroring, so this case diagnoses itself.

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

[Unreleased]: https://github.com/nielsfranke/contactsheet/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/nielsfranke/contactsheet/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/nielsfranke/contactsheet/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/nielsfranke/contactsheet/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/nielsfranke/contactsheet/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/nielsfranke/contactsheet/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/nielsfranke/contactsheet/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nielsfranke/contactsheet/releases/tag/v1.0.0
