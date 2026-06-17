# Pinned galleries (favorites)

Status: proposed — 2026-06-14

## Goal

Let the admin **pin** (favorite) galleries so they're reachable in one click from the top of the
main gallery view (`/admin/galleries`), no matter how deeply they're nested. Solves "I have a few
hot galleries buried in the folder tree and want to jump straight to them."

## Decisions (locked)

- **Global "Pinned" shelf.** A dedicated row at the very top of the overview lists every pinned
  gallery *from anywhere in the tree* — clicking one jumps straight to it (browse-in for folders,
  detail page for leaves), so a deeply-nested favorite is one click away.
- **Hover star control.** Each overview card gets a star toggle (top-left). It appears on hover on
  desktop; it's always visible on touch and whenever the gallery is already pinned (filled/gold).
  Mirrors the existing top-right hover "Open" button.

## Scope

- Pinned shelf shows at the **root** of the overview (`?folder` unset). Inside a folder the view
  stays focused on "what's here"; the left nav tree + breadcrumb already provide wayfinding.
  (Showing the shelf in every folder is a trivial follow-up if wanted.)
- Pinning is an **admin-only** organisational flag. It never touches the public gallery, never
  cascades to sub-galleries, and is not part of presentation/collaboration look or presets.

## Data model

New column on `galleries`:

| Column | Type | Default | Notes |
|---|---|---|---|
| `pinned` | `Boolean NOT NULL` | `false` | Admin favorite flag |

- **Migration `0023_gallery_pinned.py`** — `batch_alter_table("galleries")` adds `pinned` with
  `server_default="0"` (mirrors the `0021` pattern). No index: the set of galleries is small and the
  overview already loads the whole tree.
- No `pinned_at` column. The shelf orders pinned galleries by the **current instance overview sort**
  (Name / Date / Photos + direction), so it's consistent with the rest of the page and avoids a
  second column. ("Most-recently-pinned first" can be added later if desired.)

## Backend (router → service → repo, REST-first)

No new endpoint — pinning rides the existing `PATCH /api/galleries/{id}`.

- **`models/gallery.py`** — add `pinned: Mapped[bool] = mapped_column(Boolean, nullable=False,
  default=False)`.
- **`schemas/gallery.py`**
  - `GalleryUpdate`: add `pinned: bool | None = None`.
  - `GalleryResponse`: add `pinned: bool = False`.
- **`services/gallery_service.py`** — in `update_gallery`, handle `pinned` **separately** (a plain
  `if data.pinned is not None: updates["pinned"] = data.pinned`). It is deliberately **not** added to
  `_PASSTHROUGH_UPDATE_FIELDS`, because that set is the basis for `_CASCADE_FIELDS` /
  `_INHERIT_CREATE_FIELDS` — pinning must not cascade to children or be inherited on create.
- `_build_response` already splats `gallery.__dict__`, so `pinned` flows into the response with no
  further change. No repo change (the generic `gallery_repo.update(**kwargs)` already persists it).

## Frontend

All state rides the existing cached `["galleries"]` tree; no new query.

- **`lib/types.ts`** — `GalleryResponse` gains `pinned: boolean`; `GalleryUpdate` gains
  `pinned?: boolean`. (`api.galleries.update` already accepts a `GalleryUpdate`.)
- **`lib/gallery-sort.ts`** — promote the detail page's local `flattenTree` here as a shared export
  (`flattenTree(tree): { g, depth }[]`) and update the detail page's import. The overview uses it to
  collect every pinned gallery tree-wide.
- **`app/admin/galleries/page.tsx`**
  - `pinMutation` → `api.galleries.update(id, { pinned })`, `onSuccess` invalidates `["galleries"]`
    (optimistic update + toast with Undo, matching the page's other mutations).
  - `pinned = flattenTree(galleries).map(x => x.g).filter(g => g.pinned)`, ordered with the existing
    `sortGalleries(pinned, sort, dir)`.
  - Render a **`PinnedShelf`** above the grid **only when** `folderId == null`, no active filter, and
    `pinned.length > 0`: a small "★ Pinned" heading + a row of the same `GalleryTile`s (drag/organize
    disabled), each opening via the existing `openGallery`.
  - Pass an `onTogglePin` callback + `pinned` flag into every `GalleryTile`.
- **`GalleryTile`** — add a star button. Placement: top-left. The sub-gallery `Layers` badge (also
  top-left today) moves to sit in a horizontal row to the **right** of the star so they don't
  overlap; the bottom-left mode chip and top-right Open button are unchanged. Star styling: same
  translucent-black circular pill as the Open button; filled gold (`fill-current text-amber-400`)
  when pinned, outline when not. `onClick` calls `e.stopPropagation()` then `onTogglePin`.

### Accepted trade-off

A pinned **top-level** gallery appears both in the shelf and in the root grid (the shelf is tree-wide;
the root grid lists top-level galleries). This is the normal "favorites bar duplicates the source"
behaviour and is left as-is rather than de-duping the grid.

## Out of scope / follow-ups

- Pin indicator / pinned-first ordering in the left `GalleryTree` nav.
- Shelf inside every folder (not just root).
- `pinned_at` for "recently pinned first".
- Reordering favorites within the shelf (drag).

## Touched files

- `backend/alembic/versions/0023_gallery_pinned.py` (new)
- `backend/app/models/gallery.py`
- `backend/app/schemas/gallery.py`
- `backend/app/services/gallery_service.py`
- `frontend/src/lib/types.ts`
- `frontend/src/lib/gallery-sort.ts` (promote `flattenTree`)
- `frontend/src/app/admin/galleries/page.tsx` (shelf + tile star)
- `frontend/src/app/admin/galleries/[id]/page.tsx` (use shared `flattenTree`)
