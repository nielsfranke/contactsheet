# Drag-and-Drop Organising (move photos & galleries)

Status: **implemented** (2026-06-12) — Phase 1 (photo moves) + Phase 2 overview gallery
reparenting done.

Refinements (2026-06-12):
- Photo move now invalidates **all** `["gallery-images"]` queries (source + destination) so a moved
  photo shows up in the target gallery without a manual refresh.
- The overview defaults to a clean root-only grid; an **"Organize"** toggle reveals sub-gallery
  chips, enables drag-to-reparent, and shows a persistent "move to top level" drop zone (the obvious
  way to pull a nested gallery back out).

Still deferred: reparenting from the far-left `GalleryTree` nav (would need the reparent handler
centralised in `AdminDndProvider` so it works on every page) — the overview Organize mode already
covers nest / un-nest / reparent.

Let admins reorganise content by dragging, in the admin UI only:

1. **Photo → sub-gallery card** (on a gallery's detail page) — moves the image into that sub-gallery.
2. **Photo → folder in the left nav** (detail sidebar) — moves the image into that gallery.
3. **Gallery → another gallery** — reparents a gallery (nest / un-nest), on the **All Galleries**
   overview and on the detail page.

All of these are *move* operations; #1 and #2 are the **same** backend call with different drop
targets. Uses dnd-kit (already in the project for grid reorder + footer reorder).

---

## 0. Hard constraint: 2-level nesting

Galleries nest at most **2 levels** (root → sub; sub-galleries cannot have children — enforced today
in `create_gallery`). Reparent validation must preserve this:

| Move | Allowed? |
|---|---|
| sub → different root (as its sub) | ✅ |
| sub → top level (un-nest) | ✅ |
| root **without** children → under a root | ✅ |
| root **with** children → under a root | ❌ would be 3 levels |
| gallery → itself / its own descendant | ❌ cycle |
| → a target that is itself a sub-gallery | ❌ (target must be a root) |

Blocked drops are visually rejected (no highlight / not-allowed cursor) and the API also rejects them
(`400`) as a backstop.

---

## 1. Backend

### Photos — already exists
`POST /api/images/{image_id}/move` `{ target_gallery_id }` → `image_service.move_image` (moves the
files + reslots `sort_order`). No change needed. Frontend `api.images.move` already wired.

### Galleries — new
- `schemas.gallery.GalleryMove`: `{ target_parent_id: str | None }` (`null` = move to top level).
- `gallery_service.move_gallery(db, gallery_id, target_parent_id)`:
  - 404 if gallery (or non-null target) not found.
  - `target_parent_id is None` → set `parent_id = None` (un-nest).
  - else: target must be a **root** (`target.parent_id is None`) → else `400` "Target must be a
    top-level gallery"; `target_parent_id != gallery_id`; gallery must have **no children**
    (`get_children` empty) → else `400` "Move its sub-galleries out first".
  - On success: `parent_id = target_parent_id`, `sort_order` = append at destination, bump
    `updated_at`. **No file movement** — a gallery's images keep their own `gallery_id`; only the
    parent link changes.
- Router: `POST /api/galleries/{gallery_id}/move` (admin-only) → `GalleryResponse`.
- An `Activity` entry (reuse the existing activity log) for the move — optional, nice-to-have.

No migration (uses existing `parent_id` / `sort_order`).

---

## 2. Frontend — shared bits
- `api.galleries.move(id, targetParentId)`; types as needed.
- **Instant move + toast** with an **Undo** action (sonner supports an action button): undo replays
  the inverse move (`move` back to the original gallery / parent). No confirm dialog — drag is
  intentional and reversible.
- Keep the existing image **Move dialog** as an accessible fallback.
- Sensor: `PointerSensor` with `activationConstraint.distance: 8` so click-to-open-lightbox and the
  existing reorder still work.

---

## 3. Phase 1 — photo moves (detail page)

The detail page (`/admin/galleries/[id]`) gets **one page-level `<DndContext>`** wrapping both the
canvas and the sidebar (the sidebar is portalled, but React context crosses portals, and dnd-kit
collision uses DOM rects, so this works).

- **Draggables:** image tiles. `AdminImageGrid`'s own `<DndContext>` is **lifted out** — the grid
  keeps its `SortableContext` + sortable tiles, but the provider now lives on the page. Reorder
  handling (arrayMove + `api.galleries.reorder`) moves to the page's `onDragEnd`. Images become
  draggable regardless of sort mode (for moves); reorder still only applies when sort = manual and
  the drop target is another tile.
- **Droppables (move targets):**
  - Each **sub-gallery card** in the canvas Sub-Galleries section (`useDroppable`, id
    `gallery:{childId}`).
  - Each **folder in the sidebar nav** (`GalleryAdminSidebar` parent/siblings/children links →
    `useDroppable`, id `gallery:{id}`).
- **`onDragEnd` decision:** if `over` is `gallery:{X}` → `api.images.move(activeImageId, X)`; else if
  manual sort and `over` is a tile → reorder. Highlight valid drop targets on drag-over (ring +
  subtle bg). A `DragOverlay` shows the dragged thumbnail.

## 4. Phase 2 — gallery reparenting

### All Galleries overview (`/admin/galleries`) — primary surface
- Make the overview **tree-aware**: render each root tile with its sub-galleries (draggable too), so
  any gallery can be a drag source.
- **Draggables:** gallery tiles. **Droppables:** every **root** tile (`useDroppable`,
  `parent:{rootId}`) + a **"Top level"** drop zone (a dashed strip / the page header area,
  `parent:root`).
- `onDragEnd`: dropping gallery A on root B → `api.galleries.move(A, B)`; on the top-level zone →
  `api.galleries.move(A, null)`. Disallowed drops (see §0) don't highlight; the API is the backstop.
- Invalidate `["galleries"]` (and any open `["gallery", id]`) on success.

### Detail page — secondary
- Sub-gallery **cards are draggable** (within the page `DndContext`). Drop a sub-gallery card on the
  sidebar **"All Galleries"** link (`useDroppable`, `parent:root`) → un-nest to top level. (Direct
  sub→different-parent from the detail page isn't shown there since other roots aren't visible —
  that's done on the overview; un-nest + re-nest covers it.)

---

## 5. Files (anticipated)
- Backend: `schemas/gallery.py` (`GalleryMove`), `services/gallery_service.py` (`move_gallery`),
  `routers/galleries.py` (`POST /{id}/move`).
- Frontend: `lib/api.ts` + `lib/types.ts`; `app/admin/galleries/[id]/page.tsx` (page DndContext,
  drop targets, dragEnd, reorder moved up); `components/admin/AdminImageGrid.tsx` (drop its own
  DndContext, expose sortable items / reorder hook); `components/admin/GalleryAdminSidebar.tsx`
  (droppable nav folders + "All Galleries"); `app/admin/galleries/page.tsx` (tree-aware tiles +
  gallery DnD); a small shared `useDroppable` wrapper if helpful.

## 6. Out of scope
- Public/client gallery DnD (admin only).
- Multi-select drag (one item at a time for v1).
- Deeper than 2-level nesting.
- Dragging onto the OS/file system or uploads via the same context (upload stays its own zone).
