# Admin Galleries — Contextual Navigator

Status: **approved & implemented** (2026-06-13)

Rework the admin galleries overview (`/admin/galleries`) so the left rail and the main canvas stop
showing the same top-level list twice. Today both surfaces render the same root galleries — the rail
(`GalleryTree`) as a list, the canvas as cover cards — so the rail reads as a pointless duplicate
whenever nothing is expanded (exactly the reported complaint).

Adopt a **master–detail / file-browser model** (Finder · Lightroom · Apple Photos):

- **Rail = "where am I"** — the persistent, full-depth folder tree. Owns *structure*: nesting,
  reparent, filter, create. It's chrome, so it gets lighter visual weight.
- **Canvas = "what's here"** — the contents of the **currently-selected folder**, with a breadcrumb.
  Owns *browsing*. Clicking a folder updates the canvas instead of always jumping to a gallery's
  management page.

That single shift turns "two copies of one list" into one coherent navigator: with any nesting the
two surfaces show *different levels*, so they no longer duplicate.

This is a deliberately distinct design. Rather than a flat section-nav rail (Galleries /
Collections / Inboxes), our differentiator is the depth-aware folder tree plus a photo-first
editorial card. Leaning into the tree is a structurally different mental model, not a
re-skin.

Scope: the overview page (`/admin/galleries`) and the shared rail's click/selection behavior. The
**gallery detail page** (`/admin/galleries/{id}`) is unchanged — it keeps its dedicated per-gallery
management sidebar (`GalleryAdminSidebar`); that's the "manage this gallery" mode, a separate thing
from browsing.

---

## 1. No backend changes

`api.galleries.list()` already returns the full tree with everything needed: `children[]`,
`image_count` (own photos, excludes children), `cover_image_url`, `parent_id`, `has_password`,
`mode`, `comment_count`. The breadcrumb path is computed client-side from this tree.

---

## 2. One predictable click rule everywhere (rail + canvas)

**Has sub-galleries → browse into it; a leaf → open its detail page.** One rule, applied identically
in the rail and the canvas, keyed on `g.children.length > 0` — a property the user can *see* (the
`Layers`/folder badge), so behaviour follows appearance.

| Gallery | Click behavior |
|---|---|
| **Has children** (folder or mixed) | **Browse into it** → set the current folder; canvas shows its children. If it *also* has its own photos, those surface as an `OwnPhotosCard` (see §4). |
| **Leaf** — no children (with or without photos) | **Open detail page** → `/admin/galleries/{id}` to manage / upload. |

### Why not "browse only when it has zero own photos"

The first cut gated browsing on `image_count === 0 && children.length > 0` (a "pure container", to
match the public side). UX review killed it: own-photo count is **invisible** on a card, so two
identical-looking galleries behaved differently for a hidden reason — clicking a folder named "Only
Subgalleries" opened a detail page because it held one stray photo. The Drive/Dropbox model is the
fix: **entering a container shows everything inside it** (subfolders + a pointer to its own files),
and behaviour keys on the *visible* "has children" signal. The detail page stays the single home for
photo *management*; the browse canvas only *points* to the photos, never duplicates the grid.

---

## 3. Current folder lives in the URL

The overview gains a notion of *current folder*, held as a query param:

- `/admin/galleries` → root (top-level galleries)
- `/admin/galleries?folder={id}` → inside that folder (its children)

Via `useSearchParams`, so it's linkable, survives refresh, and the browser Back button climbs the
hierarchy naturally. No new local state to keep in sync; the rail reads the same param to know what
to highlight/expand.

---

## 4. Canvas (`app/admin/galleries/page.tsx`)

### Breadcrumb (new, top of canvas)
`All Galleries › Rome › Spring` — text links, current crumb bold/non-link. Computed by walking the
tree to find the path to `folder` (`galleryPath(galleries, id): GalleryResponse[]` in
`lib/gallery-sort.ts`). Replaces the static `<h1>All Galleries</h1>` when inside a folder; at root
it's just "All Galleries". The current crumb carries a **manage gear** (`Settings2`, `onManage` prop)
that opens the folder's detail page — the only path to a *pure* container's photos/settings, since
clicking the folder browses in rather than opening it.

### Contents
- At root: the top-level galleries (current behavior).
- Inside a folder: that folder's `children`, plus — when the folder has its own photos — an
  **`OwnPhotosCard`** as the first cell (accent ring, "N photos / View photos →") that opens the
  detail page. This is the Drive-style "show everything inside the container" entry; it represents
  the photos as one card, it does not inline the photo grid.
- Rendered with the existing `GRID_COLS[size]` / `GAP[spacing]` from admin-view settings — unchanged
  grid mechanics, just a different source list.
- Empty folder → a short empty state ("No sub-galleries here. Open this gallery to add photos.").

### Photo-first card redesign (the legibility / differentiation fix)
Replace the current dark-scrim-overlay card with an **editorial** card:

- Full-bleed cover image (keeps `overview_shape` square / `aspect-[3/2]`).
- **Title + "N photos" on a clean line *below* the image** (not overlaid) — fixes the cramped,
  hard-to-read "Rome / 17 photos" scrim in the screenshot, and reads as a photographer portfolio
  rather than a businesslike white box.
- Small corner overlays *on the cover* only for status: `Lock` (password), `Users` (collaboration
  mode), `Layers` + count (has sub-galleries). Container cards can show a subtle "folder" affordance
  so it's clear a click drills in vs. opens.

This card is used for both root and nested levels.

### Organize mode (retained, simplified)
- Keep the **Organize** toggle for drag-to-reparent (`POST /api/galleries/{id}/move` via the existing
  `AdminDndProvider`). Cards in the current level are drag sources + nest drop targets exactly as
  today.
- **Remove** the inline "child chips under each root card" (lines ~155–161 today) — browsing into a
  folder replaces that affordance. Cross-level reparenting still works by dragging onto the rail tree
  (spans all levels) or onto the top-level drop zone.
- Nice-to-have (optional in impl): make **breadcrumb crumbs droppable** so you can drag a card onto a
  parent crumb to move it up a level.

---

## 5. Rail (`components/admin/GalleryTree.tsx`)

- Clicking a node uses the **same container/content gate** as the canvas: container → browse
  (`router.push('/admin/galleries?folder={id}')`); content/empty → open detail
  (`/admin/galleries/{id}`, current behavior).
- Reflect the canvas location: highlight the current `?folder` node and auto-expand its ancestor
  path (extend the existing `currentId`-from-`useParams` highlight to also read `?folder` via
  `useSearchParams`; reuse the `matchTree`-style ancestor walk to force-expand the path).
- Lighter visual weight: it's a navigator, not content. (Tune muted foreground / spacing; no new
  primitives.)
- Filter, create, reparent-drag, add-sub: all unchanged.

---

## 6. The flat-library caveat (honest note)

With a handful of **un-nested** galleries, the rail and canvas still show the same names at root —
inherent to any master–detail layout (Finder does too). It's mitigated, not hidden, by: (a) the rail's
lighter weight, (b) photo-first cards that clearly read as "content," and (c) the breadcrumb framing
the canvas as "a location." The duplication *fully* dissolves the moment there's nesting, which is
the library state we're designing for (the app already invests heavily in nesting + reparent DnD).

---

## 7. Implementation checklist

1. `lib/gallery-sort.ts`: `galleryPath()` helper. (Routing keys directly on `g.children.length > 0`,
   so no `isContainer` predicate is needed.)
2. `app/admin/galleries/page.tsx`: read `?folder`; derive current node + its children; breadcrumb +
   manage gear; has-children click routing; `OwnPhotosCard` for the folder's own photos; photo-first
   `GalleryTile`; drop inline child chips.
3. `components/admin/GalleryTree.tsx`: has-children click routing; `?folder` highlight + ancestor
   auto-expand.
4. (Optional) breadcrumb crumbs as reparent drop targets.
5. `npm run lint` + `npm run build` (tsc).

No migration. No API change. Detail page untouched.
