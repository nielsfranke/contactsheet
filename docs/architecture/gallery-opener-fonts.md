# Gallery opener fonts (Google + bundled, categorized picker)

Status: **implemented** — 2026-06-13

Replace the 3-way `sans / serif / mono` opener-font toggle with a curated,
**categorized font picker** (Sans Serif · Serif · Display / Script · Mono · Accessibility). The
chosen font styles the **presentation opener heading** only (today's scope), in **presentation
mode only**. All fonts are **self-hosted** — `next/font/google` for the Google Fonts families,
`next/font/local` for the three accessibility fonts that aren't on Google Fonts.

## Decisions (locked with the user)

- **Loading**: self-host all via `next/font` — no client→Google request, no FOUC. Unused
  families carry `preload: false` so only the gallery's chosen font is fetched by the browser.
- **Scope**: opener `<h1>` heading only (unchanged from today). Subtitle/meta/buttons keep the
  default UI font.
- **Modes**: presentation mode only. Collaboration-mode chrome keeps the functional UI font.
- **Accessibility group**: OpenDyslexic, DejaVu Sans, DejaVu Sans Mono are **not** on Google
  Fonts → vendor the open-licensed files and load via `next/font/local`. Atkinson Hyperlegible
  Next + Next Mono come from Google Fonts.

## Font registry

Single source of rendering truth: `frontend/src/lib/gallery-fonts.ts`. Each entry:
`{ key, label, category, cssVar, headingWeight, note? }`. Categories render as section headers
in the picker (`note` is the grey sublabel, e.g. "Neutral / Modern").

| Category | Fonts (weights) |
|---|---|
| **Sans Serif** — Neutral / Modern | Inter (400/500/700) · Source Sans 3 (400/500/700) · Manrope (400/500/700) · Signika (400/600/700) · Merriweather Sans (300/400/700) · Montserrat (200/400/700) |
| **Serif** — Editorial / Classic | Merriweather (300/400/700) · Lora (400/700) · Libre Baskerville (400/700) |
| **Display / Script** — Accent-only | Bebas Neue (400) · Abril Fatface (400) · Poiret One (400) · Amatic SC (400/700) · Oleo Script (400/700) · Pacifico (400) · Pinyon Script (400) · Dancing Script (400/700) |
| **Mono** — Technical / Metadata | JetBrains Mono (400/700) |
| **Accessibility** — High legibility | Atkinson Hyperlegible Next (400/700, GF) · Atkinson Hyperlegible Next Mono (400/700, GF) · OpenDyslexic (400/700, local) · DejaVu Sans (400/700, local) · DejaVu Sans Mono (400/700, local) |

`headingWeight` exists because the opener `<h1>` is currently `font-bold`, which breaks
single-weight display/script faces. Per-font heading weight: display/script faces that top out
at 400 (Bebas Neue, Abril Fatface, Poiret One, Pacifico, Pinyon Script) render at **400**;
everything else at **700**. Rendering applies `fontWeight` inline from the registry instead of
the blanket `font-bold` class.

**Legacy aliases** — `sans` → `var(--font-sans)` (Montserrat), `serif` → Tailwind serif stack,
`mono` → `var(--font-mono)` (Geist Mono). Existing galleries keep their stored value and render
**exactly as today**. No data migration. New-gallery default stays `"sans"`.

## Backend

- `schemas/gallery.py` — widen `FontType` from `Literal["sans","serif","mono"]` to a `Literal`
  of all registry keys **plus** the three legacy aliases. This is the validation gate (Pydantic
  + OpenAPI enum) for `GalleryUpdate.opener_font` and `schemas.settings.GalleryPreset`. The key
  list is duplicated between backend (validation) and frontend (rendering metadata); a short
  comment in each points at the other.
- `models/gallery.py` — **no change**. `opener_font` is already `String(40)`; longest new key is
  18 chars. `default="sans"` stays.
- **No Alembic migration** (no schema change).

## Frontend

- `src/lib/gallery-fonts.ts` (new) — declares every `next/font` instance at module scope
  (`display: "swap"`, `preload: false`, `variable: "--font-…"`), and exports:
  - `GALLERY_FONT_VARIABLES` — space-joined `.variable` classNames for `<html>`.
  - `GALLERY_FONTS` — ordered registry (key → label/category/cssVar/headingWeight) for the picker.
  - `resolveOpenerFont(key)` → `{ fontFamily, fontWeight }` for rendering (handles legacy aliases
    + unknown-key fallback to sans).
- `src/app/layout.tsx` — append `GALLERY_FONT_VARIABLES` to the `<html>` className alongside the
  existing Montserrat/Geist variables. Variables are defined globally but cost nothing until a
  `font-family` references them (`preload:false`).
- `src/fonts/` (new) — vendored woff2 for OpenDyslexic + DejaVu Sans + DejaVu Sans Mono, each
  with its upstream license file (OFL / Bitstream-Vera-derived — both redistribution-friendly).
- `src/components/gallery/GalleryView.tsx` — replace the `OPENER_FONT` class map with
  `resolveOpenerFont(gallery.opener_font)`, applied as inline `style={{ fontFamily, fontWeight }}`
  on both the inline header `<h1>` and the hero `<h1>` (dropping the static `font-bold`). Size
  classes (`OPENER_SIZE` / `HERO_*`) unchanged.
- `src/components/admin/FontPicker.tsx` (new) — shadcn `Popover` trigger showing the current
  font's label (rendered in that font); content is a scrollable list grouped by category with
  grey section headers, each option previewing "Gallery Title" in its own face (fonts are
  globally available, so previews are accurate). A check marks the current value.
- `src/components/admin/gallery-settings-fields.tsx` — swap the `Segmented` 3-option control in
  `PresentationFields` for `<FontPicker>`. `PresentationValues.opener_font` type widens to the
  new `FontType`. Consumed unchanged by `GallerySettingsModal` (per-gallery) and
  `PresetEditorModal` (instance default presets).
- `src/lib/types.ts` — widen `FontType` to the full key union (mirrors backend).

## Out of scope / follow-ups

- Broadening the font beyond the opener heading (subtitle, meta, whole surface).
- Per-font fine-tuning of letter-spacing/line-height for script faces.
- Collaboration-mode title font.
- A separate metadata/EXIF mono-font setting (the Mono category here is an opener choice only).
