<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Folder drag-to-upload

**Status:** implemented (2026-06-16)

## Goal

Let the photographer **drag a folder** onto the admin upload zone and have all
compatible media inside it uploaded into the current gallery — **flattened, no
sub-galleries created**. Mixed/unsupported files inside the folder are silently
skipped; nested sub-folders are descended into and their media collected too.

This matches how photographers actually organise shoots on disk (a folder of
JPEGs per session) and removes the friction of selecting hundreds of files by
hand or having to open the folder first.

## Current state & the gap

Only one drop surface exists for multi-file gallery upload:
`frontend/src/components/admin/UploadZone.tsx`. Its handler does:

```ts
function onDrop(e: React.DragEvent) {
  e.preventDefault();
  setDragging(false);
  onFiles(Array.from(e.dataTransfer.files));
}
```

`DataTransfer.files` only exposes **top-level files**. When a directory is
dropped it appears as a single zero-content `File` (often a `.DS_Store`-sized
blob) — so dropping a folder currently uploads nothing. To read folder contents
the browser exposes the **File and Directory Entries API** via
`DataTransferItem.webkitGetAsEntry()`, which we must traverse recursively.

The single-file dialogs (`HeaderImageDialog`, `CoverImageDialog`) and the public
`ClientUploadButton` (button-only, no drop) are **out of scope** — folders make
no sense for a single header/cover image, and public upload has no drop zone.

## Design

### 1. New util: `lib/drop-files.ts`

A single async helper that flattens a `DataTransfer` into a `File[]`:

```ts
collectDroppedFiles(dt: DataTransfer, accept: (f: File) => boolean): Promise<File[]>
```

- Reads `dt.items` and calls `webkitGetAsEntry()` on each **synchronously**
  (critical: the items list is invalidated after the handler returns / after the
  first `await`, so we snapshot all entries first, then await).
- **File entry** → included as-is (it was dropped directly, so the user gets the
  existing per-file validation toast downstream if it's the wrong type).
- **Directory entry** → recursively read via `readEntries()` in a loop (the
  reader returns batches of ≤100, so we call until it yields empty), and each
  descendant file is kept **only if `accept(file)` is true** — folder contents
  are filtered *silently* (no toast spam for `.DS_Store`, sidecar `.xmp`, raw
  files, etc.).
- **Fallback**: if `webkitGetAsEntry` is unavailable (or `dt.items` is empty),
  return `Array.from(dt.files)` — current behaviour, so nothing regresses.

`accept` is derived from the existing accepted MIME/extension lists so the util
has no knowledge of upload rules baked in.

### 2. `UploadZone.onDrop` becomes async

```ts
async function onDrop(e: React.DragEvent) {
  e.preventDefault();
  setDragging(false);
  const files = await collectDroppedFiles(e.dataTransfer, isAcceptedMedia);
  if (files.length) onFiles(files);
}
```

Everything downstream is unchanged: `onFiles` → `useImageUpload.uploadFiles` →
`validateFiles` (MIME + size caps) → `api.images.upload`. Directly-dropped wrong
files still toast; folder contents are pre-filtered so they don't.

### 3. Accepted-type predicate

`useImageUpload.ts` already owns `ACCEPTED_IMAGE_TYPES` / `ACCEPTED_VIDEO_TYPES`.
Export a small `isAcceptedMedia(file)` from there (or a shared constants module)
so `drop-files.ts` and `validateFiles` agree on what "compatible" means — single
source of truth, no drift.

### Why filter folder contents but not direct drops

A dropped folder is a bulk gesture — the user can't see what's inside, so
silently taking the media and ignoring the rest is the least-surprising
behaviour ("kompatibler Inhalt wird hochgeladen"). A directly-dropped file is an
explicit choice, so a "wrong type" toast remains useful feedback. Keeping the
existing `validateFiles` toast for the latter preserves that.

## Out of scope / non-goals

- **No sub-gallery creation** from folder structure (explicit requirement). The
  tree is flattened; folder names are discarded.
- Public client upload folder-drop (no drop zone there today).
- Single-image header/cover dialogs.
- Progress is still one aggregate bar (existing behaviour); a folder of 500
  files uploads as one batch like a 500-file multi-select would.

## Files touched

| File | Change |
|---|---|
| `frontend/src/lib/drop-files.ts` | **new** — `collectDroppedFiles` traversal util |
| `frontend/src/hooks/useImageUpload.ts` | export `isAcceptedMedia` predicate (reuse existing type lists) |
| `frontend/src/components/admin/UploadZone.tsx` | async `onDrop` using the util |

No backend, schema, or i18n changes. (Optionally tweak the drop-zone subtitle
copy to mention folders — a one-line i18n string — if desired.)
