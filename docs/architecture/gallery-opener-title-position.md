<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Gallery opener — title position

## Problem

The presentation hero (`GalleryPresentationLayout`) overlays the gallery title +
subtitle on the full-screen header image, hardcoded to dead-center. Photographers
want to place the title elsewhere over the image — e.g. top-left, bottom-right —
so it sits in dead space of the photo rather than over the subject.

This is presentation-only: the collaboration layout shows the header image with
no title overlay (the title lives in the sidebar), so the setting has no effect
there and is hidden for Review-mode galleries.

## Model

New per-gallery field:

```
opener_title_position : str  NOT NULL  default "center"
```

A single string enum of nine anchor values — `top-left`, `top-center`,
`top-right`, `center-left`, `center`, `center-right`, `bottom-left`,
`bottom-center`, `bottom-right`. One column (not two axes) keeps it a single
setting that travels through the existing field-list plumbing unchanged.

`center` is the default and reproduces today's layout exactly — existing
galleries are untouched after migration backfill.

- **Migration 0038** — `opener_title_position` on `galleries`, `server_default="center"`.
- **Schema** (`schemas/gallery.py`): a `TitlePositionType = Literal[...]`; add to
  `GalleryCreate`, `GalleryUpdate`, both response models (default `"center"`),
  and `GalleryPreset` in `schemas/settings.py`.
- **Service field lists** (`gallery_service.py`): add `opener_title_position` to
  `_PASSTHROUGH_UPDATE_FIELDS` (so update + cascade + inherit pick it up via
  `_CASCADE_FIELDS`/`_INHERIT_CREATE_FIELDS`) and to `_PRESET_FIELDS` (so the mode
  preset can default it). It sits alongside `opener_font`/`opener_font_size`,
  which already live in all four sets — no new wiring path.

## Rendering (presentation hero)

The title block container (`GalleryPresentationLayout.tsx`) swaps its fixed
`items-center justify-center … text-center` for classes derived from the value:

| axis | value → class |
|---|---|
| vertical (`justify-*`)  | top→`justify-start` · center→`justify-center` · bottom→`justify-end` |
| horizontal (`items-*`)  | left→`items-start` · center→`items-center` · right→`items-end` |
| text-align              | follows horizontal: left→`text-left` · center→`text-center` · right→`text-right` |

A static `Record<position, string>` map of full class strings (Tailwind-scannable,
per the `ui-tokens` convention) keeps it declarative. The scrim, studio masthead
(top-left), photo-count line, and scroll indicator (bottom-center) are unchanged.
Padding bumps from `px-8` to `px-8 py-20` so top/bottom anchors clear the masthead
and scroll indicator.

The standard (no-image) header is **not** affected — the request is specifically
about placement *within the header image*.

## Admin UI

A 3×3 anchor-grid picker added to `OpenerFields`
(`gallery-settings-fields.tsx`), under Heading font/size — the Look tab's
presentation-only opener block (`GallerySettingsModal` shows `OpenerFields` only
when `mode === "presentation"`). Nine cells; the active cell is highlighted;
clicking one autosaves via the existing `useGallerySettingsAutosave` "select
on change" path (no Save button). Mirrored read-only/interactive into
`PresetEditorModal` so the mode preset can set the default.

## i18n

Add `settings.fields.titlePosition` label + nine `aria-label`s (or a compact
`titlePos.*` group) to `en.json`; run `node scripts/validate-i18n.mjs`.

## Invariants

- Default `center` ⇒ byte-identical hero for every existing gallery.
- Presentation-only: collaboration galleries ignore the field (hidden in UI,
  no overlay to position).
- Travels the same create/update/cascade/inherit/preset paths as the other
  opener fields — no bespoke handling in `gallery_service`.
