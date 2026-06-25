# Batch rename (admin multi-select)

Status: proposed — 2026-06-25

## Goal

When an admin has multiple images selected (select mode), offer a **Batch
rename** action that renames all selected images in one pass, with a live
before→after preview. Extends the existing bulk-action pattern (move / delete)
in the gallery-detail selection block.

## What "rename" touches (and what it doesn't)

`Image.original_filename` is a **pure display/metadata field** (`backend/app/models/image.py`).
It is *not* the on-disk path — files live under their immutable UUID
`stored_filename`. So a rename is a metadata-only update; no files move.

But `original_filename` **is** the member name used in ZIP downloads
(`zip_task.collect_members`) and in the "copy filenames" export. Two consequences:

- **Extensions are always preserved.** The rename operates on the filename
  *stem*; the original extension (`.jpg`, `.cr2`, `.mov`, …) is re-appended
  verbatim. This keeps downloads valid and avoids users accidentally stripping
  an extension across a whole selection.
- **Duplicate names are allowed** (the column has no unique constraint, same as
  today's single rename). ZIP export already de-dups member names per folder,
  so collisions degrade gracefully. The dialog *warns* on collisions but does
  not block.

## Backend

**No new endpoint and no migration.** Reuse the existing single-image update:

```
PATCH /api/images/{image_id}   { original_filename }
```

`image_service.update_image` already strips whitespace and falls back to the
current name on empty (`backend/app/services/image_service.py:387`). The batch
is N sequential PATCH calls from the client — identical to the existing bulk
move / delete pattern (`useGalleryDetail.tsx:315`, `:335`). Sequential keeps a
clean "stop on first error, surface one toast" failure mode and needs no new
server code or transaction semantics.

## Frontend

### New dialog — `components/admin/BatchRenameDialog.tsx`

Props: `{ open, onOpenChange, images, onApply, busy }` where `images` is the
selected images **in current grid order** (so sequence numbering matches what
the admin sees). Three modes (radio/segmented):

1. **Sequence** — `base` + `separator` + zero-padded counter.
   Controls: base name, start number (default 1), padding digits (default 3),
   separator (default `-`). Result: `Wedding-001.jpg`, `Wedding-002.jpg`, …
2. **Find & replace** — `find` → `replace`, applied to the stem, all
   occurrences, case-sensitive. (`DSC_` → `Beach_`.)
3. **Prefix / suffix** — prepend `prefix` and/or append `suffix` to the stem.

A shared `splitExt(name)` helper (last `.`, ignoring a leading dot) computes
`{ stem, ext }`; every mode rewrites only `stem` and re-appends `ext`.

**Live preview**: a scrollable list of `old → new` for the selected images
(first ~12 shown, "+N more"). Rows whose name is unchanged are de-emphasised.
A small warning line appears if the new set contains duplicate names.

`onApply` receives only the `{ id, name }[]` whose name actually changed.

### Controller — `useGalleryDetail.tsx`

- State: `batchRenameOpen`.
- Derived: `batchRenameImages` = visible images filtered to `selection.selected`,
  in display order (reuse the same ordered array the grid renders).
- `batchRenameMutation`: sequential `api.images.update(id, { original_filename })`
  over the supplied renames; on success invalidate `["gallery-images", id]`,
  clear selection, exit select mode, toast `imagesRenamed { count }`. Mirrors
  `deleteSelectionMutation`.

### Selection bar — `components/admin/GalleryAdminSidebar.tsx`

New optional prop `onRenameSelection`; a button in the select block (a lucide
text/pencil glyph, label `renameSelection`), placed near "Move to gallery",
`disabled` when nothing is selected. Wired from the page that renders the
sidebar → `setBatchRenameOpen(true)`.

### Dialog mount — `GalleryDetailDialogs.tsx`

Render `<BatchRenameDialog>` off the controller state, alongside the existing
rename / move dialogs.

## i18n

New keys in `frontend/messages/en.json` (source of truth) under `admin.detail`
(dialog: title, mode labels, field labels/placeholders, preview, duplicate
warning, apply) and the sidebar namespace (`renameSelection`). Validate with
`node scripts/validate-i18n.mjs` before committing; mirror any keys the
validator requires across catalogs.

## Out of scope (v1)

- Regex find & replace (literal substring only).
- Renaming the on-disk file / `stored_filename`.
- A bulk server endpoint (revisit only if very large selections make N PATCHes
  too slow in practice).
