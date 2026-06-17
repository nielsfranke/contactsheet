# Sub-Gallery Navigation Redesign

Status: **approved & implemented** (2026-06-12)

Rework how sub-galleries surface in the **public** gallery view so navigation and content stop
competing. Today every gallery with a parent or children renders large cover cards inline above the
photo grid (plus a "Back" cover card), which looks unbalanced — a single child becomes a huge card
beside empty space.

Driven by one rule: **cover cards only when the gallery has no photos of
its own.**

| Gallery | Treatment |
|---|---|
| **Container** — own photos = 0, has children | Children as **centered cover-thumbnail cards** (a "choose a section" landing page); no photo grid |
| **Content** — has own photos (with or without children) | Photos own the page; children appear **only as text links** in a breadcrumb |
| **Leaf** — has a parent, no children | No cards; breadcrumb provides the parent (back) link |

A **breadcrumb** (`[Parent ›] **Current** › child · child`, all text links) replaces the current
"Back" cover card and the always-on cards as the primary nav affordance.

Scope: public `GalleryView` only — both presentation and collaboration modes. The admin in-gallery
view keeps its dedicated "Sub-Galleries" management section (it's an editor, not the client
presentation) — unchanged.

---

## 1. No backend changes

Everything needed is already on `GalleryPublicResponse`:
`image_count` (the gallery's **own** photos, excludes children), `subgalleries[]`
(`name`/`share_token`/`image_count`/`cover_image_url`), and `parent_name`/`parent_share_token`/
`parent_cover_image_url`. Container detection = `image_count === 0 && subgalleries.length > 0`.

---

## 2. Frontend

### New component — `src/components/gallery/GalleryBreadcrumb.tsx`
- Renders a single centered row: optional **parent** link → **current** gallery name (bold,
  non-link) → each **child** as a link, separated by a chevron between levels and middots/spacing
  between siblings (e.g. `Testing › Subgallery Subgallery2`).
- Props: `parent` (`{name, share_token}` | null), `current` (string), `children`
  (`{name, share_token}[]`), `bright` (text-color flag). Links go to `/g/{share_token}`.
- Shown whenever there's a parent or at least one child.

### `GalleryView.tsx`
- **Container flag:** `const isContainer = gallery.image_count === 0 && gallery.subgalleries.length > 0;`
- **`subGalleryCards`** (the existing cover-card block):
  - Render **only when `isContainer`** (instead of `hasNav`).
  - **Remove the "Back" parent card** — the breadcrumb/sidebar now owns back-nav.
  - **Center** the cards: wrap in a `max-w-*` mx-auto container; keep the existing
    `GRID_COLS[preview_size]`/`GAP[preview_spacing]` sizing so a few children stay tidy and centered
    rather than stretching full-width.
- **Presentation layouts (all 3 variants):** render `<GalleryBreadcrumb>` at the top of `<main>`
  (above the photo grid / container cards) when there's a parent or children. Then
  `{isContainer ? subGalleryCards : null}` + `{photoGrid}` + `{galleryFooter}`. (A content gallery =
  breadcrumb + photos; a container = breadcrumb + centered cards, no grid.)
- **Collaboration layout:** keep the existing **sidebar** nav (parent/siblings/children text links)
  as the breadcrumb equivalent — no top breadcrumb added. Apply the same `isContainer` gate to the
  main-column `subGalleryCards`. So a content gallery shows only photos in the main column; a
  container shows the centered cover cards.
- `hasNav` stays for deciding whether the sidebar nav block renders (unchanged).

### Notes
- `photoGrid` already renders nothing/great for 0 photos; for a container we simply don't render it,
  so no "empty grid" state.
- The footer placement (bottom of each `<main>`) is unchanged.

---

## 3. Docs (on implementation)
- Update the redesign notes / CLAUDE.md public-gallery section to describe the container-vs-content
  rule and the breadcrumb.
- Reference this doc.

## 4. Out of scope
- Admin in-gallery view (keeps its management "Sub-Galleries" section).
- Deep multi-level breadcrumbs (we show parent → current → children, one level each way;
  grandparents are reachable by walking up).
- Any change to cover-image selection or the cards' hover/labels beyond removing the Back card.
