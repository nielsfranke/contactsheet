# Unlimited Nested Galleries + Drag-to-Reparent Everywhere

Status: **implemented** (2026-06-12). Deep nesting (backend + cycle check + public breadcrumb
ancestors), centralised reparent in `AdminDndProvider`, and drag surfaces — detail-page sub-gallery
cards (drag a card onto another to nest, e.g. Sub 1 → IWB), the far-left `GalleryTree` nodes (shown
on non-detail pages), and the overview tiles/chips — all done. The per-gallery sidebar nav folders
remain gallery drop targets. Verified: card-into-card, tree-node-into-node, overview chip-into-chip
(all 3-level), photo move + reorder preserved.

Follow-up (2026-06-12): the non-drag image-move path (tile kebab → "Move to gallery…") was
generalised from direct sub-galleries to the **whole gallery tree** — a depth-indented picker with a
name filter; the image's current gallery is listed but flagged "Current" and disabled.

Two linked changes:

1. **Remove the 2-level nesting cap** — galleries can nest to any depth (like folders), so a
   sub-gallery can contain sub-galleries (e.g. "Only Subgalleries → IWB → Sub 1").
2. **Drag-to-reparent galleries on more surfaces** — the gallery detail page's **Sub-Galleries
   cards** and the far-left **navigation tree**, in addition to the existing All Galleries overview.

This requires centralising the gallery-reparent drag logic so it works on every admin page (today
each page registers its own DnD handler, and the far-left tree lives in the shared layout).

---

## 1. Backend — arbitrary depth

- `gallery_service.create_gallery`: drop the `parent.parent_id is not None → 400` check.
- `gallery_service.move_gallery`: drop "target must be a root" and "gallery must have no children".
  Keep self-move rejection and add **cycle prevention**: reject if the target is the gallery itself
  or any **descendant** of it (walk up the target's ancestors; if the moved gallery is among them,
  reject `400 "Can't move a gallery into its own sub-gallery"`). Append `sort_order` at the
  destination as today.
- `_build_tree` is already recursive — the admin tree (`api.galleries.list`) handles any depth with
  no change.

### Public gallery — full ancestor path
The breadcrumb today is one level each way (`parent → current → children`). With deep nesting it
needs the whole path:
- `GalleryPublicResponse`: add `ancestors: [{ name, share_token }]` (root-first, excluding current),
  populated in `get_public_gallery` by walking `parent_id` up. Keep `parent_*` (still handy) and
  `subgalleries` (direct children).
- No migration (uses existing `parent_id`).

---

## 2. Frontend — centralised reparent DnD

### `AdminDnd.tsx` (the layout-level provider) gains ownership of gallery reparenting
Because the far-left tree is in the layout and reparenting must work everywhere, the provider — not
individual pages — owns it:
- Holds the `api.galleries.move` mutation (invalidate `["galleries"]`, toast + Undo).
- Tracks `activeDrag` ({ id, kind: "image" | "gallery" }) in context so any surface can dim its
  source / render an overlay.
- **One universal `collisionDetection`**: the drop zone under the pointer (`pointerWithin`), else —
  only when dragging an **image** — `closestCenter` (for tile reorder); a gallery drag with no zone
  under the pointer resolves to nothing.
- **One `onDragEnd`**: if the active is a **gallery** (`data.reparent`) and the drop is a gallery
  zone → reparent (top-level zone → `move(id, null)`); otherwise delegate to the page's registered
  `onDragEnd` (image move / reorder).
- **One `DragOverlay`**: a gallery chip for gallery drags (name from drag data); for image drags it
  calls the page-provided `renderOverlay(activeId)`.
- Page config shrinks to `{ onDragEnd, renderOverlay }` (sensors + collision now fixed in provider).

### Unified drop/drag data scheme
- **Drop zones** carry `data: { galleryId }` (the target gallery) or `data: { topLevel: true }`.
  Ids stay unique per instance (`{galleryId}:{surface}`) so the same gallery as a card + nav folder +
  tree node + overview tile don't collide. A photo dropped on such a zone still moves into
  `galleryId` (image path); a gallery dropped on it nests into `galleryId` (reparent path) — the
  `onDragEnd` branches on the active's kind.
- **Drag sources** (gallery) carry `data: { reparent: true, galleryId, parentId, name }`; the
  draggable id is `{galleryId}:{surface}` (unique per surface).

### Surfaces
- **Detail page Sub-Galleries cards** — each card becomes a gallery drag source *and* a gallery drop
  zone (it's already an image drop zone). Drag one card onto another → nest. (Self/descendant drops
  rejected by the backend; client guards self.)
- **Far-left `GalleryTree`** — each node becomes a drag source + drop zone; works on every admin
  page. A small "top level" affordance (e.g. the "Galleries" header) un-nests.
- **Overview** (existing) — refactor its tiles/chips to the unified scheme and let the provider
  handle the move (removes the page's own move mutation/handler).
- **Detail sidebar nav folders** (`GalleryAdminSidebar`) — already image drop zones; add the gallery
  drop data so they also accept gallery drops.

### Public `GalleryBreadcrumb`
Render the full `ancestors` chain (links) → current (bold) → children, instead of just the parent.

---

## 3. Phasing
- **3a** Backend: depth cap removal + cycle check + `ancestors`; public breadcrumb path. (Self
  contained, testable via API.)
- **3b** Centralise reparent in `AdminDndProvider` (move overview onto it — behaviour-preserving).
- **3c** Add the new drag surfaces (detail cards, tree, sidebar nav).

## 4. Risks
- Touches the **verified** photo-move / reorder DnD — the universal collision + onDragEnd must
  preserve those exactly. Mitigated by 3b being behaviour-preserving and re-testing photo move +
  reorder after each step.
- Deeper trees in the public sidebar/breadcrumb need sensible truncation for very deep paths (wrap /
  ellipsis); functionally correct regardless.

## 5. Out of scope
- Reordering galleries within a level via drag (only reparenting).
- Collapsing/expanding state persistence in the overview.
