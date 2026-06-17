# IPTC metadata display (and scrapping the contact sheet)

Status: implemented (2026-06-15)

Activates the previously-scaffolded per-gallery `show_iptc` toggle and **removes** the
never-built `contact_sheet_enabled` scaffolding. IPTC display mirrors the existing EXIF
display end-to-end: extracted from the original at upload time, stored as JSON on the image,
exposed on the API, and rendered in the lightbox behind a per-gallery toggle.

## What IPTC gives us that EXIF doesn't

EXIF = camera/capture facts (already shown: make, model, focal length, aperture, shutter, ISO).
IPTC IIM = editorial/descriptive metadata the photographer writes in Lightroom/Photoshop/Bridge:
title, caption, keywords, creator, copyright, credit, location. Showing it lets clients see the
intended captions and rights info on a photo.

## Backend

### Extraction (`app/tasks/image_processing.py`)
Add `_extract_iptc(img)` alongside `_extract_exif`, called in `process_image` (images only —
videos already skip this pipeline). Uses Pillow's `IptcImagePlugin.getiptcinfo(img)` (returns
`{(record, dataset): bytes | list[bytes]}` or `None`). We map a focused IIM field set (record 2):

| IIM dataset | Key | Notes |
|---|---|---|
| `(2, 5)`   | `title`       | Object Name |
| `(2, 105)` | `headline`    | |
| `(2, 120)` | `description` | Caption/Abstract |
| `(2, 25)`  | `keywords`    | repeatable → `list[str]` |
| `(2, 80)`  | `creator`     | By-line |
| `(2, 116)` | `copyright`   | |
| `(2, 110)` | `credit`      | |
| `(2, 90)`  | `city`        | |
| `(2, 95)`  | `state`       | Province/State |
| `(2, 101)` | `country`     | Country/Primary Location Name |

Bytes are decoded UTF-8 with a latin-1 fallback; blanks dropped; repeatable keys collapse to a
list. Returns `dict | None` (None when no fields present). Wrapped in `try/except` like EXIF so a
malformed block never fails processing.

### Storage
- New column `images.iptc_data TEXT NULL` (JSON string), mirroring `exif_data`. **Migration `0028`.**
- `image_repo.update_processing_result` gains an `iptc_data: str | None` kwarg.
- `process_image` stores `json.dumps(iptc_dict)` (or None).
- Backfill: not automatic — only newly-uploaded images get IPTC (same as any past metadata change).
  Existing images simply show no IPTC. (A re-process command is out of scope.)

### API
- `ImageResponse.iptc_data: dict[str, Any] | None = None` (schemas/image.py).
- `image_service._image_to_response` parses the stored JSON into `iptc_data` (mirrors `exif`).

### Scrap contact sheet
- Drop `galleries.contact_sheet_enabled` (model + **migration `0028`** drops the column in the same
  revision).
- Remove from `schemas/gallery.py` (`GalleryUpdate`, `GalleryResponse`, `GalleryPublicResponse`) and
  from `gallery_service._PASSTHROUGH_UPDATE_FIELDS`.

## Frontend

- `types.ts`: add `iptc_data?: Record<string, string | string[]> | null` to `Image`; remove
  `contact_sheet_enabled` from the gallery type.
- **Settings** (`gallery-settings-fields.tsx`): `LookValues` gains `show_iptc`; the IPTC `<Toggle>`
  becomes live (mirrors the EXIF toggle, with an `iptcHint`); the **Contact sheet toggle and the
  whole `comingSoon` prop are removed** (no scaffolded look-toggles remain). `GallerySettingsModal`
  seeds/sends `show_iptc` and drops `comingSoon={gallery}`. `PresetEditorModal` + `GalleryPreset`
  (schemas/settings.py) add `show_iptc` (so presets carry it, like `show_exif`).
- **Lightbox** (`Lightbox.tsx`): add a `showIptc` (gallery-gated) prop + an internal `showIptc`
  state with its own toolbar toggle (a `Tags`/`FileText` icon, shown when `iptc` data exists and the
  gallery enables it) and an IPTC panel beneath the EXIF panel. The panel renders labeled rows
  (Title, Caption, Keywords as chips, Creator, Copyright prefixed ©, Credit, Location = city/state/
  country joined). EXIF stays a separate toggle/panel — a gallery may enable either independently.
- `GalleryView.tsx` passes `showIptc={gallery.show_iptc}`; the admin in-gallery lightbox
  (`GalleryDetailDialogs.tsx`) passes it too (mirrors `showExif`).
- **i18n**: add `settings.fields.iptcHint`, remove `settings.fields.contactSheet`, add
  `gallery.iptc.*` field labels (title/caption/keywords/creator/copyright/credit/location) to
  `en.json` + `de.json`; run `node scripts/validate-i18n.mjs`.

## Out of scope / follow-ups
- Re-processing existing images to backfill IPTC.
- Editing IPTC from the admin UI (read-only display only).
- XMP (this reads only legacy IPTC-IIM, which Lightroom/Photoshop still write alongside XMP).
- Contact-sheet export stays scrapped — not deferred.
