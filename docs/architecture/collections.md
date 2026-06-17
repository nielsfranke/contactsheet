# Collections (image selection + saved sets)

Status: **implemented** — 2026-06-13

Let users multi-select images in a gallery and save the selection as a **named Collection**, in
both the **admin in-gallery view** and the **public collaboration ("review") view**. Activates the
scaffolded `sets_enabled` per-gallery toggle (relabelled "Collections"). Rather than an always-on
corner "+", selection is a **mode** you toggle, with full-tile highlight, shift-range,
and Ctrl/Cmd+A.

## Decisions (locked with the user)

- **Where**: both admin and public review. Collections live on the gallery; admin sees all,
  clients see all when the gallery's Collections toggle is on. Client-made collections are
  attributed to the reviewer name.
- **Actions**: **filter the grid** to a collection's members, and **download** a collection as a
  ZIP (reusing the existing filtered-ZIP flow). **Delete** is included as an essential lifecycle
  action. **Rename** is deferred (follow-up).
- **Membership**: from the current **selection**, or **"Save current filter as a collection"**
  (e.g. all red-flagged).
- **Selection UX**: a **"Select" mode toggle** — click a tile to toggle (full-tile ring + check),
  shift-click for range, Ctrl/Cmd+A selects all currently-visible (filtered) images. No corner
  checkbox.

## Data model

Migration `0018`. Two tables (collections hard-delete; the soft-delete rule is Gallery/Image only):

- **`collections`** — `id` (uuid PK), `gallery_id` (FK → galleries, cascade), `name`
  (`String(200)`), `created_by` (`String(100)`, nullable; reviewer name for client-made, null =
  admin), `created_at`.
- **`collection_images`** — `collection_id` (FK → collections, cascade), `image_id`
  (FK → images, cascade), `position` (int). PK `(collection_id, image_id)`. Membership is pruned
  naturally when an image is hard-deleted; soft-deleted images are filtered out at read time.

## Backend

- **Models** — `Collection`, `CollectionImage` (`app/models/collection.py`).
- **Repository** — `collection_repo`: list-by-gallery (with member ids + counts), create (name +
  ordered image_ids, validating ids belong to the gallery), get, delete, members.
- **Service** — `collection_service`: `list / create / delete / get_image_ids`. Create validates
  the gallery, filters `image_ids` to live images of that gallery, trims the name, stamps
  `created_by`.
- **Schemas** — `CollectionResponse { id, gallery_id, name, created_by, image_ids: list[str],
  image_count, cover_url, created_at }` (embeds `image_ids` so the client filters the
  already-loaded images with no extra round-trip), `CollectionCreate { name, image_ids }`.
- **Admin endpoints** (`app/routers/collections.py`, admin-guarded) — always available regardless
  of the client toggle (collections are also an admin organizing tool):
  - `GET /api/galleries/{gallery_id}/collections`
  - `POST /api/galleries/{gallery_id}/collections`
  - `DELETE /api/collections/{collection_id}`
- **Public endpoints** (`app/routers/public.py`, gated by `gallery.sets_enabled` → 403, plus
  `_require_gallery_access` password gate):
  - `GET /api/public/g/{share_token}/collections`
  - `POST /api/public/g/{share_token}/collections` (`creator` form/body field → `created_by`)
  - `DELETE /api/public/g/{share_token}/collections/{collection_id}`
  - Trust model matches existing collaboration writes (flags/likes/comments): anyone with gallery
    access can create/delete — reviewer "identity" is an unauthenticated name, so delete is not
    creator-restricted (noted, not secured).
- **Download** — no new ZIP work: the cover/members feed the existing
  `createFilteredZip(image_ids)` on both `/api/galleries/{id}/export/zip` and
  `/api/public/g/{token}/zip`.

## Frontend

- **Selection hook** — `useImageSelection(visibleIds: string[])` (`src/hooks/useImageSelection.ts`):
  `{ mode, setMode, selected: Set<string>, isSelected, toggle, selectRange(anchor,id), selectAll,
  clear, count }`. Tracks a last-clicked anchor for shift-range. Owns a `keydown` listener active
  only while `mode` is on: Ctrl/Cmd+A → `selectAll(visibleIds)` (preventDefault); Escape → clear.
  Lives in each top-level surface (admin page / `GalleryView`) and is threaded to the grid + the
  collections panel.
- **Types / API** — `Collection` type; `api.galleries.collections.*` (list/create/delete) and
  `api.public.collections.*` (list/create/delete with `galleryToken`).
- **Tiles** — `AdminImageGrid` tiles and public `PhotoGrid` tiles gain a selection mode: when on,
  a tile click toggles selection (not lightbox/drag), shift-click selects the range from the
  anchor, and selected tiles get a ring + corner check overlay. Drag-reorder is suspended while
  selecting.
- **Collections panel** — replaces the "Sets — Coming soon" block in both the admin
  `GalleryAdminSidebar` and the `GalleryView` collaboration sidebar (public side hidden unless
  `sets_enabled`):
  - **Select** toggle (enters/exits selection mode).
  - While selecting: "{n} selected", **Select all** / **Clear**, **Save as collection** (name
    dialog), **Save current filter as collection** (uses the current filtered set).
  - Existing collections list: click to **filter** the grid to its members (a `collectionFilter`
    id added to the surface's arrange/filter state, intersected in the existing
    `filteredSorted` memo), a **Download** action (→ `createFilteredZip`), and **Delete**.
    Admin rows show the `created_by` attribution.
- **Presentation mode** stays unaffected (collections are a collaboration/admin tool).

## Phasing

Shared backend + the selection hook land first, then admin wiring, then the public review wiring
(same components/endpoints, gated by `sets_enabled`). Built together since both were requested.

## Out of scope / follow-ups

- Rename collections; reordering within a collection; adding/removing single images after create.
- Creator-restricted deletes / authenticated reviewer identity.
- Collections in presentation mode; cross-gallery collections.
- Showing a collection's images as a shareable sub-view/link.
