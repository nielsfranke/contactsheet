# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Photographers (admins)** — self-hosting professionals and enthusiasts who shoot for clients. They run ContactSheet on their own server, upload shoots (often straight from Lightroom Classic or Capture One via the official plugins), organize nested galleries, and send share links. Motivated, returning users who tolerate density and learn the tool.
- **Clients (gallery visitors)** — non-technical, often one-time visitors who open a shared link (frequently on a phone) to browse a shoot, review it (flags, stars, likes, comments, freehand annotations), pick keepers into collections, and download originals or ZIPs. They receive no onboarding and must never need any.
- **Self-hosting operators** — usually the photographer themselves; deploy via Docker Compose, care about low resource use, backups, and not being locked in.

**Priority (confirmed):** when trade-offs pit the two surfaces against each other, the client gallery experience leads — it is the product's public face and its visitors get exactly one chance. The admin surface may assume a motivated user.

## Product Purpose

Self-hosted photo delivery: share a shoot with a client via a clean, password-optional link and let them browse, review, and choose. The digital version of the darkroom contact sheet — the page of thumbnails a photographer used to review a roll and pick the keepers. Success = a photographer delivers a shoot from their own server and the client completes their review without help; no SaaS subscription, no third party holding the photos.

## Positioning

The self-hostable alternative to paid client-gallery SaaS (Pixieset, Pic-Time, ShootProof class). The claim neighbors cannot truthfully copy: **your photos stay on your hardware, under AGPL-3.0-or-later, with original files stored and downloaded untouched.** Runs lean on a modest box (three small containers, SQLite, no database server); heavyweight extras like semantic search are strictly opt-in sidecars.

**Ambition (confirmed):** a community OSS product, not just a personal tool that leaked. Adoption by other self-hosting photographers, onboarding ease, documentation quality, and translatability (Weblate, currently EN + DE) are goals in themselves.

## Operating Context

- Photographer workflow: shoot → cull/edit in Lightroom Classic or Capture One → publish to a gallery (plugin or drag-and-drop, incl. folder drops and 8 GB working files) → configure look & behaviour per gallery (Showcase vs Review mode, presets, inheritance) → send the share link → watch feedback arrive live (WebSocket) and via notifications (email, Pushover, ntfy, Discord, Telegram, Slack, Apprise) → read client picks back into the catalog (Lightroom plugin) → deliver finals.
- Client workflow: open link (maybe enter a password) → browse a Showcase or Review gallery → flag/rate/like/comment/annotate, build collections, optionally upload their own photos (moderation queue optional) → download originals or a streamed ZIP.
- Deployment: Docker Compose behind a reverse proxy on the photographer's own domain; first-run setup wizard in the browser; one-click full-instance backup/restore.
- Legal context: European self-hosters — Impressum + privacy pages linkable from every public gallery; the AGPL §13 source offer is made to gallery visitors and is never suppressed.

## Capabilities and Constraints

- Two gallery modes — Showcase (view-only, polished) and Review (flags, ratings, likes, comments, annotations) — plus an opt-in client-side switch from Showcase into Review. Nested galleries to any depth; containers render children as cover cards.
- Feedback systems: color flags, 1–5 stars, or both (instance-wide `rating_mode`); per-reviewer likes and team voting; comments with optional drawn annotations anchored on the photo.
- Formats: JPEG/PNG/WebP/TIFF/PSD/PSB + camera RAW (previewed from the embedded camera JPEG — deliberately no RAW demosaic engine); browser-playable video only (never transcoded). Originals always stored and served untouched; all display goes through sRGB-tagged JPEG renditions.
- Optional semantic content search via a separate ML sidecar — off by default twice (admin opt-in + Compose profile); default deploy must stay lean.
- Stack is settled (FastAPI/SQLAlchemy/SQLite backend, Next.js 16 App Router frontend, Docker Compose deploy); REST-API-first — every feature must be API-accessible (PATs exist for third-party clients).
- i18n: `next-intl` without URL locale prefixes; `en.json` is source of truth; backend stays English with stable error `code`s. Every user-facing string must be translatable.
- Constraint: no invented claims — no fake testimonials, customer logos, pricing tiers, or benchmarks anywhere; ContactSheet is free software with a voluntary Ko-fi.

## Brand Commitments

- **Name:** ContactSheet — the darkroom contact-sheet metaphor (review a roll, pick the keepers) is the founding story; keep it available to design work.
- **Assets:** app icon at `docs/brand/contactsheet-icon.png`; PWA icons are rendered server-side from instance branding (logo → monogram → default).
- **Voice:** plain, honest, first-person-indie in project copy (README states "I built this for myself"; limits are documented candidly). Product UI copy is neutral and translatable.
- **Two separate identity systems (binding):** the admin surface uses the instance accent (`--primary`, one accent emphasis per view); public galleries carry the *photographer's* branding (brand color, fonts, footer) — the app's own brand recedes on client surfaces. Don't cross the two.
- License identity: AGPL-3.0-or-later is part of the positioning, not fine print.

## Evidence on Hand

- Real screenshots in `docs/screenshots/` (linked from README/wiki); demo assets under `demo/` with credited Lorem Picsum/Unsplash placeholder photos (`demo/assets/CREDITS.md`).
- Extensive architecture records in `docs/architecture/` and `ARCHITECTURE.md`; user guide and self-hosting docs in the GitHub wiki; `CHANGELOG.md` at v1.9.3.
- Companion repos: `contactsheet-lightroom`, `contactsheet-captureone`.
- **Absent (do not fabricate):** testimonials, named customers, usage numbers, performance benchmarks, press.

## Product Principles

1. **The client's one visit wins ties.** The shared gallery is the product's face; a non-technical visitor on a phone must succeed with zero instruction. Admin power never leaks complexity into the client surface.
2. **The photos are the interface.** Both surfaces exist to show photographs well — chrome recedes, originals are sacred (stored and delivered untouched), and anything composited (watermarks, renditions) is deliberate and reversible.
3. **Self-hosted lean by default, powerful by opt-in.** The three-container SQLite deploy is the contract; anything heavy (ML search, sqlite-vec) ships off-by-default and degrades gracefully when absent.
4. **The photographer's brand, not ours, on public surfaces.** Client galleries are white-label-ish by design; ContactSheet's own identity lives in the admin and the legally required source link.
5. **Open and honest.** AGPL obligations are honored visibly, limits are documented rather than hidden, and no marketing claim outruns the evidence on hand.

## Accessibility & Inclusion

**WCAG 2.1 AA is a hard requirement across both admin and client surfaces (confirmed).** Existing code already guarantees contrast on accent fills (`accentForeground()`); future work must extend AA to keyboard access, focus visibility, semantics, and motion. Client galleries additionally assume touch-first, small-screen, unfamiliar users; the app is community-translated, so no string may be hard-coded English.
