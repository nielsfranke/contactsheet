# Gallery Settings Modal — visual + structural redesign

Status: implemented 2026-06-13.

## Problem

The per-gallery `GallerySettingsModal` was functional but looked unfinished: every
on/off control was a bare HTML checkbox, the tab bar had no icons, the "Start client
view in" control was a plain bordered box, sizes were text-only `S/M/L` buttons, and
rows were laid out inconsistently. This pass makes it intuitive, stylish, and pretty
in our own design language (accent-driven, semantic theme tokens) — built around a
clear 4-tab structure.

Scope is **beautify + reorganize existing options**. No new backend fields, no API
change, no migration. The existing "Coming soon" toggles (scribbles, sets, client
upload, contact sheet, IPTC) are unchanged.

## Changes

- **New primitive `frontend/src/components/ui/switch.tsx`** — styled wrapper over
  `@base-ui/react/switch` (track `bg-input` → `data-checked:bg-primary`, sliding thumb).
  Replaces every checkbox in the settings forms. This is the biggest visual win.

- **`frontend/src/components/admin/gallery-settings-fields.tsx`** (shared by the modal
  and `PresetEditorModal`):
  - `Toggle` now renders the `Switch` (keeps the `comingSoon` disabled+badge path; new
    `indent` prop nests dependent toggles like Team voting under Likes).
  - `Segmented` is an iOS-style track (`bg-muted` container, active segment
    `bg-background shadow-sm`) and gained an optional per-option `icon`.
  - New `SectionLabel` (small uppercase muted header) groups rows within a tab.
  - `PresentationFields` grouped: Opener / Image previews / Background.
  - `CollaborationFields`: visual Layout picker with glyph icons (Grid/Masonry/List);
    toggles grouped Interactions / Display / Show file information.

- **`frontend/src/components/admin/GallerySettingsModal.tsx`**:
  - `DialogDescription` with a link to `/admin/settings/gallery-defaults`.
  - Hero "Start client view in" = two accent-highlighted mode cards (icon + label +
    hint) instead of a plain box.
  - Tab bar with lucide icons (General/Collaboration/Presentation/Security), accent
    underline + accent text when active.
  - Tab content reorganized: **Downloads moved from Security to General** (Security is
    now purely protection: password, expiry, watermark). Collaboration/Presentation
    tabs each carry a one-line "applies when the gallery opens in X mode" hint.
  - Footer "Apply to all sub-galleries" is now a `Switch`.

- `PresetEditorModal` is unchanged structurally — it consumes the same shared fields
  and inherits the new switches/segmented styling.

## Client-facing mode names

For clearer client-facing wording than "Collaboration / Presentation", the two
modes are **displayed** as **Review** (collaboration) and **Showcase** (presentation).
The internal `ModeType` enum values (`"collaboration"` / `"presentation"`) are
unchanged — no migration, no API change. A single source of truth lives in
`frontend/src/lib/types.ts`:

```ts
export const MODE_LABELS: Record<ModeType, string> = {
  collaboration: "Review",
  presentation: "Showcase",
};
```

All display strings reference it: settings modal tabs/cards/hints, `CreateGalleryDialog`,
the `gallery-defaults` settings page, and `PresetEditorModal` (title + body). The
preset editor's two internal group headers were relabelled to content-based names
("Look & layout" / "Features") so they don't clash with the mode names.

## Title / subtitle model (follow-up)

The opener was simplified so the gallery identity reads cleanly:

- **Gallery name = the big title** (always), styled by the Presentation tab's
  opener font + size.
- **`headline` is repurposed as a smaller subtitle** (relabelled "Subtitle" in the
  General tab) shown beneath the title. It no longer replaces the name.
- **`description` was dropped** from the settings UI and from public rendering — the
  DB column/`GalleryResponse` field remain (no migration) but are unused. Existing
  values are left untouched, just no longer surfaced or editable.

Public rendering (`GalleryView`) in all three layouts — collaboration sidebar,
presentation hero, presentation header (no image) — now renders name-as-title +
optional headline-as-subtitle. **When a hero image is set in presentation mode, the
title + subtitle are centered over the image** (`absolute inset-0 flex
items-center justify-center text-center` + a darker scrim for legibility); the
scroll-to-photos cue stays pinned to the bottom.

## Constraints honoured

- `base-ui` primitives only (not radix), following the `dialog.tsx` wrapper pattern.
- Semantic theme tokens only — respects admin light/dark theme + configurable accent.
- The `handleSave` payload shape is unchanged (`downloads_enabled` still sent, just
  edited from the General tab now).

## Verification

`npm run lint` (pre-existing errors in `Slideshow.tsx`/`api.ts` only) and
`npm run build` (tsc clean) from `frontend/`. Manual: open a gallery → Settings, walk
all four tabs, toggle switches/segmented/mode cards, Save persists; then
`/admin/settings/gallery-defaults` → a preset renders with the new controls.
