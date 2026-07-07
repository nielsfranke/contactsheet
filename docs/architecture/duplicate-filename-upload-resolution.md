# Duplicate-filename upload resolution (Replace / Keep both / Skip)

Status: **implemented** (2026-07-07). Design forks decided: `replace` = in-place overwrite;
multi-match → replace newest + soft-delete older; dialog = batch default + per-file override.
**Verified:** backend suite green incl. 7 new tests (pre-flight, replace-in-place with feedback
preservation, cover-follows-replace, multi-match, keep_both `_v2`, skip, legacy append); frontend
build/lint/vitest + i18n parity (en + de) green. Triggered by photographer feedback (Matthias):
re-uploading a
new version of a photo with the **same filename** — via the web UI, Finder drag, or the Lightroom
plugin — silently drops a second copy next to the original, so the gallery ends up with two images
carrying the same number. Request: prompt on collision —

> "Das Bild XY123 ist bereits vorhanden. Wie möchtest du fortfahren?"
> - Vorhandenes Bild ersetzen
> - Beide behalten (automatisch z. B. mit `_v2` / `_v3` umbenennen)

This doc also resolves the **cover-image half** of the same feedback thread (see "Relationship to
header/cover" below): a *replace-in-place* makes a gallery cover follow the new version for free.

## Current behaviour (confirmed)

There is **no duplicate detection anywhere**. On upload (`image_service.upload_images`,
`image_service.py:218`):

- The on-disk name is always `f"{uuid4}{ext}"` (`:261`) — it never collides.
- `original_filename` is stored **verbatim, unchecked** (`:303`). No repo query looks images up by
  filename; there is no uniqueness constraint (`models/image.py`, `original_filename` is plain
  `String(500)`).
- Every trigger — admin picker/drop (`hooks/useImageUpload.ts`), public client upload, **and the
  Lightroom/Capture One PAT path** — funnels into this same primitive. The plugins avoid duplicates
  only *client-side* (delete-then-reupload via a stored id map); when that map is missing (gallery
  made by plain Export, first publish) they duplicate too.

Result: a same-name upload appends a brand-new `Image` row (new id, `sort_order = count + i`) beside
the original. Both show with the same display name.

## Goal

On upload, detect files whose name already exists (live, non-deleted) in the **target gallery** and
let the photographer choose per collision:

- **Replace** — the new bytes take over the *existing* photo **in place** (same image id).
- **Keep both** — the incoming file is renamed `name_v2.ext` / `name_v3.ext …`.
- **Skip** — the incoming file is not uploaded.

Scope for this pass: the **admin** upload UI (picker, drag-drop, folder-drop). The public
client-upload UX and the desktop plugins are explicitly **out of scope for the dialog** but the
*server contract* is designed so they can adopt it later (see "Follow-ups").

No schema change / no migration — this reuses existing columns and adds one read endpoint plus one
optional upload field.

## Design

### Two-step flow: pre-flight check, then resolved upload

Prompting *after* streaming a 300 MB original would be wasteful, so the collision check happens
**before** any bytes are sent.

```
1. user selects files
2. POST /api/galleries/{id}/images/check-duplicates  { filenames: [...] }
   → { duplicates: { "IMG_1.jpg": 1, "IMG_2.jpg": 2 } }   # name → # of live matches
3. if any duplicates → open DuplicateUploadDialog, collect a decision per colliding name
4. POST /api/galleries/{id}/images  (multipart)  + duplicate_actions JSON
```

### 1. Pre-flight endpoint (new)

`POST /api/galleries/{gallery_id}/images/check-duplicates`, scope `images:write`.

```jsonc
// request
{ "filenames": ["DSC_0421.NEF", "DSC_0422.NEF"] }
// response — only colliding names appear; value is the live-match count
{ "duplicates": { "DSC_0421.NEF": 1 } }
```

Backed by a new repo query `image_repo.filename_counts(db, gallery_id, names)` →
`SELECT original_filename, COUNT(*) ... WHERE gallery_id=? AND deleted_at IS NULL AND
original_filename IN (...) GROUP BY original_filename`. Counts **all** live rows (moderation-agnostic
— admin sees pending client uploads too). Side-effect-free.

### 2. Upload gains an optional resolution map

`POST /api/galleries/{gallery_id}/images` gains one optional multipart field:

```jsonc
duplicate_actions = { "DSC_0421.NEF": "replace" | "keep_both" | "skip" }
```

- A filename **absent** from the map keeps **today's behaviour** (silent append, no rename). This is
  the backward-compat contract for existing PAT clients (Lightroom/Capture One) and any script that
  never sends the field — nothing changes for them.
- `keep_both` → the incoming `original_filename` is rewritten to the lowest free `name_vN.ext`
  (N ≥ 2) among the gallery's live filenames, *before* `image_repo.create`. Stored name is already
  unique, so only the display name changes.
- `skip` → the file is dropped server-side (not created). The web client also filters skipped files
  out up front, so `skip` is mostly belt-and-suspenders for the API contract.
- `replace` → **in-place overwrite** of the existing photo (details below).

Resolution is applied in the per-file loop of `upload_images`, right after `original_filename` is
computed (`image_service.py:266`) and before `image_repo.create` (`:299`).

### 3. `replace` = in-place overwrite (the important decision)

Replace **keeps the existing `Image` row and its id** and swaps its pixels, rather than
delete-then-create. This is deliberate and is what makes the feature genuinely useful:

- All feedback and relations keyed by image id **survive**: comments, annotations, votes, likes,
  color flag / star rating, collection membership, `sort_order`, and — critically — any
  `galleries.cover_image_id` pointing at it.
- Mechanics: save the new bytes to a fresh `stored_filename` under `original/`; on the existing row
  set `stored_filename` = new, `processing_status="pending"`, clear `width/height/exif_data/
  iptc_data`, update `file_size/mime_type`, reset `embedding_status`; **delete the old rendition
  files** (`{gallery_id}/{original,thumb,small,medium}/{old_stored}` — reuse the fix-A
  `_IMAGE_SUBDIRS` set); enqueue `submit_image_processing`. The move-race hardening from fix A means
  the worker resolves the gallery from the live row, so this is safe.
- A new service primitive `image_service.replace_image(db, image, new_file, storage)` holds this;
  `upload_images` calls it instead of `create` when the action is `replace`.

**Ambiguity — more than one existing match.** Galleries may already hold duplicate filenames (nothing
ever prevented them). **Decided (2026-07-07):** replace overwrites the single **newest** live match
in place and **soft-deletes** any older same-name siblings, so the invariant "after a replace,
exactly one live image carries that name" holds. The dialog surfaces the count ("2 existing copies")
so the choice is informed.

### 4. Frontend — `DuplicateUploadDialog`

`useImageUpload.uploadFiles` becomes: `validateFiles` → `api.images.checkDuplicates` → if any, set a
`duplicatePrompt` state `{ collisions, resolve }` that the consumer (`useGalleryDetail`) renders as
`<DuplicateUploadDialog>` (mirrors the existing `CoverImageDialog` / `HeaderImageDialog` pattern —
consumer owns the dialog, hook owns the state). The dialog offers a **batch default** (radio: Replace
all / Keep both / Skip) with an optional **per-file override** list, resolves to a
`Record<filename, action>`, and the hook threads it into `api.images.upload(..., duplicateActions)`
(new optional arg appended to the `FormData`).

`api.images.upload` gains an optional `duplicateActions?: Record<string,string>` param appended as the
`duplicate_actions` form field. `api.images.checkDuplicates(galleryId, filenames)` is the new client
method.

## Relationship to header/cover (issue #3 in the same feedback)

The photographer also asked whether header/cover auto-update when a photo is re-uploaded. Today:
**neither does** — the **header** is a frozen re-encoded JPEG copy (`header_image_filename`, no id
reference), and the **cover** is bound to a specific image **id** (`cover_image_id`), so a new upload
(a *new* id) is never adopted.

This feature fixes the **cover** half automatically: because `replace` preserves the image id, a
gallery whose cover points at photo X shows the new version the moment X is replaced in place — no
re-selection needed. The **header** stays manual (it is a pixel copy that doesn't record its source
id; we can't know it derived from X). That residual is the "cover image issue" to discuss after this
lands — options there are (a) leave header manual, or (b) additionally store the source image id on
the header so it can offer/auto a refresh. Deferred.

## Backward compatibility & edge cases

- **PAT clients unchanged**: no `duplicate_actions` field → legacy append. Lightroom/Capture One keep
  working exactly as today.
- **Same name twice within one batch** (two folders each with `IMG_1.jpg`): the map is keyed by
  filename and can't disambiguate → both keep today's behaviour (both uploaded). Noted, not solved.
- **Replace across type** (video replacing an image or vice-versa): allowed; `is_video`, renditions
  and `video_url` are recomputed from the new bytes. Rare; called out in tests.
- **Rename scheme** honours the photographer's `_v2/_v3` request (versioning mental model). Note this
  differs from the export-time de-dup in `zip_task` which uses `name-1.ext` — that one is
  ephemeral/download-only, this one persists on the row.

## Tests (backend)

- pre-flight returns colliding names + live-match counts; ignores soft-deleted rows.
- `replace` overwrites in place: **same image id**, new dimensions after processing, feedback
  (a like + a comment) preserved, old rendition files gone, exactly one live row with that name.
- `replace` with a `cover_image_id` pointing at the target → cover url reflects the new bytes.
- `replace` with 2 pre-existing same-name rows → one live remains (documents the rule).
- `keep_both` → new row named `…_v2`, both live.
- upload with **no** `duplicate_actions` → legacy append (regression guard for PAT clients).

## Follow-ups (out of scope here)

- **Plugins**: teach the Lightroom/Capture One publish services to send `duplicate_actions:replace`
  by filename, so a re-publish overwrites in place even when the client-side id map is missing —
  removing the plugin duplicate-on-missing-map failure entirely. Server-side support ships here.
- **Public client upload**: decide whether moderated client uploads should prompt (likely just
  auto-`keep_both` rename — clients shouldn't overwrite each other's photos).
- **Header source tracking** for the cover/header residual above.

## Deploy impact

None beyond the image pull. No migration, no nginx/compose change. Feature is additive and inert for
any client that doesn't send the new field.
