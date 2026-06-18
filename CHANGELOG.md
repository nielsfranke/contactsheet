<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

All notable changes to ContactSheet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/nielsfranke/contactsheet/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/nielsfranke/contactsheet/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/nielsfranke/contactsheet/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nielsfranke/contactsheet/releases/tag/v1.0.0
