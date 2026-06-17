<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

All notable changes to ContactSheet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/nielsfranke/contactsheet/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nielsfranke/contactsheet/releases/tag/v1.0.0
