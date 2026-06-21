<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

All notable changes to ContactSheet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
