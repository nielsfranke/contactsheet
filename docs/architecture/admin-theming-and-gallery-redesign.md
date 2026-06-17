# Architecture: Admin theming + per-gallery settings + in-gallery redesign

Status: **APPROVED** (2026-06-11) — Phases A, B & C all ✅ done (2026-06-11)
Date: 2026-06-11
Scope owner: —

## 1. Problem & goals

Three distinct asks, surfaced from the "background color setting isn't working" report:

1. **Admin theming (admin-only).** A real Light / Dark preset switch plus a working
   Accent color. Today neither works:
   - `accent_color` is persisted in `app_settings` but **nothing reads it into CSS** — it is
     a dead setting.
   - The app is hard-locked to dark: `layout.tsx` pins `class="… dark"` on `<html>`, and
     virtually every admin component is painted with literal `zinc-*` utilities instead of the
     semantic theme tokens (`bg-background`, `text-foreground`, …). `globals.css` already
     defines full light + dark palettes, but no component consumes them, so flipping the theme
     does almost nothing.
2. **Per-gallery client-facing customization.** A "Gallery Settings" modal (tabs:
   General / Collaboration / Presentation / Security) controlling how each *public* gallery
   looks and behaves — layout, preview size/spacing/corners, opener heading & font, background
   brightness, and which collaboration features are on. (Reference screenshots provided.)
3. **In-gallery admin UX.** Move the cluttered single-scroll admin gallery page into a
   **left sidebar** (Settings / Preview / Share, Upload, Download, Filter, Arrange, Sets) with a
   clean main canvas, and **simplify the upload** to a single minimal drag-and-drop zone.

Non-goals: theming the public gallery from the admin theme (public look is driven entirely by
each gallery's own settings — workstream B).

## 2. Current state (verified in code)

| Area | File | Today |
|---|---|---|
| Admin theme | `frontend/src/app/layout.tsx` | hardcoded `dark` class on `<html>` |
| Theme tokens | `frontend/src/app/globals.css` | full light + dark palettes defined, **unused** by components |
| Accent color | `app_settings.accent_color` | stored, posted, **never applied** to any CSS var |
| Settings UI | `frontend/src/app/admin/settings/page.tsx` | instance name, accent (dead), logo |
| Gallery model | `backend/app/models/gallery.py` | `mode`, `layout`, `headline`, `header_image_filename`, `downloads_enabled`, `enable_team_voting`, `watermark_settings`, `expires_at`, `password_hash` |
| Gallery admin page | `frontend/src/app/admin/galleries/[id]/page.tsx` | one long vertical stack: header → export → upload → grid → voting → header image → watermark → ZIP → activity |
| Upload | `frontend/src/components/admin/UploadZone.tsx` | dropzone + inline per-file progress list |

## 3. Workstream A — Admin theming (admin-only)

### A.1 Data
Add to `app_settings` (migration `0006`):
- `admin_theme` `VARCHAR(10)` default `"dark"` — `"light" | "dark"`.
- (`accent_color` already exists — reuse.)

Backend: extend `AppSettingsUpdate` / `AppSettingsResponse` (`schemas/settings.py`) and the
PATCH handler (`routers/admin_settings.py`) with `admin_theme`.

### A.2 Applying the theme
- A small client component (`AdminThemeProvider`) wraps the admin tree. It reads
  `admin-settings`, then:
  - toggles the `dark` class on `document.documentElement` (the `@custom-variant dark` in
    `globals.css` keys off `.dark`; light is simply its absence),
  - sets `--primary` / `--primary-foreground` (and `--ring`) from `accent_color` via
    `style.setProperty`. **Not `--accent`** — in this shadcn token scheme `--accent` is the
    subtle hover/highlight background; the brand color buttons and highlights consume is
    `--primary`. `--primary-foreground` must be computed for contrast (white/black depending
    on the accent's luminance).
- Remove the hardcoded `dark` from `layout.tsx`; default theme applied by the provider (avoid
  FOUC with a tiny inline pre-hydration script reading a cached value).
  *Implementation note:* this Next.js version diverges from common conventions
  (`frontend/AGENTS.md`) — consult `node_modules/next/dist/docs/` for the supported way to
  inject an inline pre-hydration script in the root layout before writing it.

### A.3 The real work — token migration (admin only)
Replace literal `zinc-*` / color utilities with semantic tokens **in the admin surface only**:
- `src/app/admin/**`, `src/components/admin/**`, shared `src/components/ui/**` already use tokens.
- Mapping guide: `bg-zinc-950→bg-background`, `bg-zinc-900→bg-card`/`bg-sidebar`,
  `text-zinc-100→text-foreground`, `text-zinc-400/500→text-muted-foreground`,
  `border-zinc-700/800→border-border`, accent highlights → `bg-primary`/`text-primary`.
- Public gallery components (`src/components/gallery/**`, `src/app/g/**`) are **out of scope
  here** — they are governed by workstream B and keep their own styling.

### A.4 Settings UI
In `admin/settings/page.tsx`, add a "Appearance" section: Light/Dark segmented control +
live-applied accent color picker (fix the dead control).

## 4. Workstream B — Per-gallery settings modal

Replace the small "Edit Gallery" dialog with a tabbed **Gallery Settings** modal. Top: a
"Start Client View In: Collaboration / Presentation" segmented control (maps to existing
`gallery.mode`). Tabs below.

### B.1 New Gallery columns (migration `0006`, same migration)
Presentation:
- `opener_heading` (reuse existing `headline`)
- `opener_font` `VARCHAR(40)` default `"sans"`
- `opener_font_size` `VARCHAR(10)` default `"medium"` — small/medium/large
- `preview_size` `VARCHAR(10)` default `"medium"`
- `preview_spacing` `VARCHAR(10)` default `"medium"`
- `preview_corners` `VARCHAR(10)` default `"round"` — round/square
- `bg_brightness` `VARCHAR(10)` default `"dark"` — bright/dark
- `bg_dimmed_color` `VARCHAR(20)` nullable

Collaboration:
- `layout` (exists) — extend values to grid/masonry/list
- `color_flags_enabled` BOOL default true
- `likes_enabled` BOOL default false (+ reuse `enable_team_voting` for votes)
- `comments_enabled` BOOL default true
- `scribbles_enabled` BOOL default false  *(depends on Annotations — Phase 3 Feature 8, not built)*
- `sets_enabled` BOOL default false  *(new feature — not built)*
- `client_upload_enabled` BOOL default false  *(new feature — not built)*
- `show_filename` / `show_exif` / `show_iptc` BOOL
- `contact_sheet_enabled` BOOL default false  *(new feature — not built)*

Security (mostly exists): `password_hash`, `expires_at`, `downloads_enabled`, watermark.

### B.2 Honesty about coverage
Some reference toggles map to features **that do not exist yet** (scribbles/annotations, sets,
client upload, contact sheet). Proposal: in this workstream we (a) build the settings schema +
modal UI for everything, (b) **wire only the toggles backed by working features**
(mode, layout incl. masonry & list, color flags, likes/votes, comments, downloads, file-info
display, all presentation styling), and (c) render the not-yet-built toggles disabled with a
"Coming soon" hint rather than faking them. Those features become their own follow-ups.

### B.3 Public rendering
`GalleryView` / `PhotoGrid` / opener read the new fields to drive layout, spacing, corners,
background brightness/dim, and opener typography. This is where the public gallery becomes
"very customizable."

### B.4 API
Extend `PATCH /api/galleries/{id}` (schema + service) with the new fields; include them in the
gallery read model and the public gallery payload. `apply_to_subgalleries: bool` option to
cascade settings to descendants.

## 5. Workstream C — In-gallery admin redesign

Restructure `admin/galleries/[id]/page.tsx` into a two-column layout:
- **Left sidebar:** gallery title + kebab (delete/rename); Settings (opens modal from B),
  Preview (open `/g/<token>`), Share (copy link); Upload New Files; Download; Filter (filename,
  flag chips); Arrangement (Sort By, Group By); Sets.
- **Main canvas:** photo grid (`AdminImageGrid`) + a single minimal Drag & Drop zone + a
  Sub-Galleries section.
- Move watermark / ZIP / header image / activity / voting **out of the scroll** and into the
  Settings modal tabs or the kebab menu.

### C.1 Simplified upload
Trim `UploadZone` to the reference: one dashed "Drag & Drop … or click here" panel. Keep
progress feedback minimal (a single aggregate bar / toast) instead of the per-file list.

## 6. Migration & compatibility
- Migration `0006` adds `app_settings.admin_theme` (Phase A). Migration `0007` adds all new
  `galleries.*` columns (Phase B) — split out because Phase A shipped first. Both use safe
  defaults → existing rows and the API stay backward compatible.
- Update `CLAUDE.md` migration ledger and Phase 3 status.

## 7. Proposed phasing (each independently shippable)
- **Phase A** — Admin theming: migration field, provider, settings UI, token migration. (Fixes
  the original bug; smallest blast radius.)
- **Phase B** — Gallery Settings modal + schema + public rendering of presentation/layout.
- **Phase C** — In-gallery sidebar redesign + simplified upload.
- Follow-ups (separate): Annotations/scribbles, Sets, Client upload, Contact sheet.

## 8. Open questions — RESOLVED 2026-06-11
1. Admin theme scope: **global instance setting** in `app_settings`.
2. Phase B unbuilt toggles: **build full schema now, render disabled with "Coming soon" hint**.
3. Order: **Phase A first**, then B, then C.
