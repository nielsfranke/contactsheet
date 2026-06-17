<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Create a gallery from a set of images (collection / filter / selection)

Status: proposed (2026-06-17)

## Goal

Admin-only: spin off a **new gallery from a chosen set of photos** in an existing gallery. The set
can come from three sources, all of which reduce to "an ordered list of image IDs":

- a **collection** (saved selection),
- the **active filter** (e.g. all green-flagged photos, or a filename match), or
- a **manual multi-select** (Select mode).

For every source the admin chooses, in one dialog:

- **Destination** — a **new gallery** (then: **Name** + **Placement** = sub-gallery of the current
  gallery or top-level) **or** an **existing gallery** (picked from the gallery tree),
- **Operation** — **Copy** (duplicate the photos; source + collection stay intact) or **Move**
  (relocate the photos out of the source).

This is admin-only; the public side is untouched.

## Design

One generic backend primitive — "make a gallery from these image IDs" — that knows nothing about
collections or filters (those are just ID sources on the frontend). No schema change, no migration.

### Backend

**Storage** — add `copy(src, dst)` to the `StorageProvider` ABC (`storage/base.py`) and
`LocalStorage` (path-traversal-safe, mirroring the existing `move`). Used by the copy path.

**Image copy** — new `image_service.copy_image_to_gallery(db, image, target_gallery_id, storage,
sort_order) -> Image`:
- New `Image` row, new `id`, new `stored_filename` (`{uuid}{ext}`), `gallery_id = target`,
  `sort_order` as given.
- Copies the on-disk renditions that exist (`original` / `thumb` / `medium`, plus the video poster
  if any) via `storage.copy` from `{src_gallery}/{sub}/{old}` → `{target}/{sub}/{new}`.
- Carries over intrinsic metadata: `original_filename`, `width`, `height`, `file_size`,
  `mime_type`, `exif_data`, `iptc_data`, `tags`, `is_video`, `processing_status="done"`.
- **Resets feedback** (a fresh gallery starts clean): `color_flag="none"`, `likes=0`,
  `uploaded_by=None`, `moderation_status="approved"`. Comments / annotations / votes / per-user
  likes are keyed by `image_id`, so the new row simply has none — nothing to copy.

**Derive service** — new `gallery_service.derive_gallery(db, source_gallery_id, data, storage)`:
1. Load source gallery (404 if missing).
2. Filter `data.image_ids` to live images of the source (preserve order, drop dupes/foreign ids);
   400 if none valid — same guard style as `collection_service.create_collection`.
3. Validate `data.parent_id` is `None` (top-level) or an existing gallery.
4. Create the new gallery via the existing `create_gallery` with
   `GalleryCreate(name, parent_id, mode=source.mode)` — so a sub-gallery inherits the parent's
   look (existing `_INHERIT_CREATE_FIELDS` path) and a top-level one gets the mode preset.
5. For each valid image in order: **copy** (`copy_image_to_gallery`) or **move**
   (`image_service.move_image`, which already moves files + sets `sort_order` + publishes realtime),
   numbering `sort_order` 0..n.
6. Log a `"derived"` activity on the source gallery; return the new `GalleryResponse`.

**Bulk transfer** — `image_service.transfer_images(db, *, image_ids, source_gallery_id,
target_gallery_id, operation, storage)` is the single bulk primitive: validates the ids belong to the
source (preserve order, drop dupes), 400/404 guards, then copies (`copy_image_to_gallery`) or moves
(`move_image`) each, appended to the target's existing photos. Used by **both** the derive path and
the existing-gallery transfer.

**Schema** — `GalleryDerive` (`schemas/gallery.py`): `name: str(1..255)`, `image_ids: list[str]`
(min 1), `parent_id: str | None = None`, `operation: Literal["copy","move"] = "copy"`.
`ImageTransfer` (`schemas/image.py`): `image_ids` (min 1), `target_gallery_id`, `operation`; result
`TransferResult{count, target_gallery_id}`.

**Endpoints** (both in `routers/galleries.py`, `get_current_admin`, admin-only, no rate limit —
consistent with other admin gallery routes):
- `POST /api/galleries/{gallery_id}/derive` → new gallery (`response_model=GalleryResponse`, 201).
- `POST /api/galleries/{gallery_id}/images/transfer` → copy/move into an **existing** target
  (`response_model=TransferResult`).

### Frontend

**API** — `api.galleries.derive(galleryId, { name, image_ids, parent_id, operation })` and
`api.galleries.transferImages(galleryId, { image_ids, target_gallery_id, operation })`.

**Dialog** — new `components/admin/CreateGalleryFromImagesDialog.tsx` (shadcn `Dialog`): a
**destination** segmented control (New gallery / Existing gallery); for *new* a name input + placement
segmented control (`Inside "{current}"` / `Top level`); for *existing* the depth-indented tree picker
(reusing `flattenTree`/`moveTargets`, source gallery excluded); an **operation** segmented control
(Copy / Move) with a one-line trade-off hint (move-from-a-collection notes the collection removal);
and a `Create / Create & open` (new) or `Apply / Apply & open` (existing) footer. Self-contained
(owns its mutation); the detail page seeds it via a `{ imageIds, defaultName, collectionId, nonce }`
state — the `nonce` keys a remount so each open starts fresh (no reset effect).

**Entry points** (all in `GalleryAdminSidebar`, admin in-gallery view):
- **Per collection row** — a new `FolderPlus` hover action (next to rename/download/delete) →
  opens the dialog with the collection's `image_ids` + its name as default; `sourceCollectionId` set.
- **From the active filter** — a `Create gallery from filter` button next to the existing
  `Save filter` (shown when `filterActive`), seeded with the currently filtered IDs and a sensible
  default name (the single active flag's label, else "Selection").
- **From a manual selection** — a `Create gallery from selection` button in the Select-mode actions,
  seeded with the selected IDs.

**Mutation** (`useGalleryDetail`): calls `derive`, then invalidates `["galleries"]` (the new gallery
appears in the tree/sub-gallery list) and — for **Move** — `["gallery-images", sourceId]` (source
lost photos). On **Move from a collection**, also delete that now-empty collection
(`sourceCollectionId`) and invalidate `["collections", sourceId]`. Toast with **Undo**? No — Undo
would have to reverse a multi-image move + a gallery create; out of scope. Success toast + optional
"Open" via `Create & Open`.

### Notes / trade-offs

- **Copy duplicates bytes** (originals can be large) — surfaced in the dialog hint. **Move** is a
  cheap rename but empties the photos from the source (and, for a collection source, consumes the
  collection — hence the auto-delete).
- The backend stays a clean generic primitive; "collection vs filter vs selection" lives entirely in
  the frontend as different ways to produce `image_ids`.
- Single-process realtime: `move_image` already publishes; copy publishes nothing for the (viewerless)
  new gallery. The admin tree refresh is via query invalidation.

## Out of scope

- Public/client ability to spawn galleries (admin-only by design).
- Cross-gallery sources (the IDs must belong to one source gallery).
- Carrying feedback (flags/comments/votes) into the new gallery.
- Drag-to-reorder of the derived gallery beyond the source order (normal manual sort applies after).
