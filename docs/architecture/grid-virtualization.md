<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Grid virtualization

**Status:** implemented (2026-06-25) on branch `feature/perf-scale`.

> Implementation notes vs. this proposal: shipped as designed. Justified row-math is
> in `src/lib/justified-layout.ts` (Vitest parity test); windowing primitives are
> `WindowedRows` (shared) + `WindowedFixedGrid` (grid/list); `JustifiedGrid` takes a
> `virtualize` flag so admin dnd-kit sortable opts out. Threshold = 150
> (`VIRTUALIZE_THRESHOLD`). Rows are dynamically measured (handles filename captions /
> natural-aspect list tiles). Virtualized admin drag-reorder remains the follow-up.

## Goal

Large galleries (2000+ photos) render **every tile at once** today, so the DOM holds
thousands of `<img>`/`<video>` nodes plus per-tile React state and hover handlers.
On mobile that means slow first paint, janky scroll, and high memory — the photo
grid is the app's core surface, so this is the most-felt perf gap. Virtualize the
grids so only the on-screen rows (plus a small overscan) are mounted.

## Where images render today

- **Public** `PhotoGrid.tsx` — three layouts, all mapping over the full `ready` array:
  - **masonry** → `JustifiedGrid` (Flickr-style justified rows; already computes an
    exact per-row height from container width + aspect ratios).
  - **grid** → a responsive CSS grid (`GRID_COLS[size]`), square tiles.
  - **list** → 1–2 column CSS grid, natural-aspect tiles.
- **Admin** `AdminImageGrid.tsx` — same `JustifiedGrid`/grid, but tiles can be wrapped
  in a dnd-kit `SortableContext` (reorder) or be plain-draggable (move-to-gallery),
  inside the page-level `DndContext`.
- `GalleryView` renders **one** `PhotoGrid` ungrouped, or **several** (one per
  `<section>`) when grouped by flag/rating — all sharing one `lightboxImages` sequence.

## Approach: `@tanstack/react-virtual`, row-windowed, against the window scroll

The gallery scrolls the **page**, not an inner fixed-height box, so use
`useWindowVirtualizer` — no layout change, no forced scroll container.

The key simplification: **we already know every row's height**, so the virtualizer
gets exact sizes (no measurement pass, no layout thrash):

- **masonry** — `JustifiedGrid` already produces `rows: {height, cells[]}[]`. Refactor
  it to compute that array (as now), then render rows through the virtualizer using
  each row's exact `height` as its size. Visible rows only.
- **grid/list** — measure the container width (the grid already does this in the
  justified path), derive an explicit **column count** from the size preset/breakpoints,
  chunk images into rows of N, and window those rows. Square tiles → row height is the
  computed cell width (exact); list tiles use the row's natural aspect.

Each virtualized row is absolutely positioned at its `start` offset inside a spacer
of the total height — the standard react-virtual pattern.

### Threshold — keep small galleries byte-identical

Only virtualize past a cutoff (e.g. **> 150 images**); below it, render exactly as
today. Small galleries (the overwhelming majority) get zero behavior change and zero
new overhead; only big ones pay for (and benefit from) windowing.

### Lightbox, lazy-loading, live updates

- The lightbox already traverses `lightboxImages` (the full ordered list), independent
  of which tiles are mounted — so opening/paging the lightbox is unaffected.
- `loading="lazy"` stays as a second-line defense; virtualization is the primary win
  (lazy alone still creates all DOM nodes + React state).
- React Query invalidation/refetch is unchanged — the data array is the same; only how
  many tiles are mounted changes.

## Scope (pass 1) and the drag-and-drop caveat

Virtualize:
1. The **public** `PhotoGrid` (all three layouts) — the main mobile-jank win.
2. The **admin** grid in **non-reorder** modes (browsing, move-to-gallery).

**Leave admin active "reorder" mode non-virtualized** for now: dnd-kit's
`SortableContext` needs all sortable items mounted to compute moves, and windowed
drag-sorting is a known-hard combination. Manual hand-reordering of a 2000-image
gallery is rare (the sort controls cover bulk ordering), so this is an acceptable
pass-1 boundary — noted as a follow-up. Grouped `<section>` views virtualize each
section independently (sections are already smaller subsets).

## Risks / mitigations

- **Justified layout parity** — the refactor must keep `JustifiedGrid`'s output pixel-
  identical (it's shared by public + admin). Mitigation: extract the row-computation
  into a pure function with a unit test (Vitest) asserting row break points + heights
  for a fixed input, before wiring the virtualizer.
- **Scroll restoration / anchor jumps** — windowing can shift scroll if sizes are
  wrong; exact known heights avoid this. Verify on the E2E path + manual mobile check.
- **`ResizeObserver` on rotate/resize** — recompute rows on width change (already done).

## Files (estimate)

| File | Change |
|---|---|
| `frontend/package.json` | add `@tanstack/react-virtual` |
| `frontend/src/lib/justified-layout.ts` | **new** — extract pure row-computation from `JustifiedGrid` (+ Vitest) |
| `frontend/src/components/JustifiedGrid.tsx` | render rows via `useWindowVirtualizer` past the threshold |
| `frontend/src/lib/gridLayout.ts` | helper to derive explicit column count from size/width |
| `frontend/src/components/gallery/PhotoGrid.tsx` | window the grid/list layouts past the threshold |
| `frontend/src/components/admin/AdminImageGrid.tsx` | window non-reorder modes |
| `frontend/src/lib/justified-layout.test.ts` | **new** — row-break parity test |
| `docs/architecture/grid-virtualization.md` | promote on approval |

No backend change. One small client dependency (`@tanstack/react-virtual`, ~a few KB,
tree-shaken). Default (small-gallery) rendering path is unchanged.

## Non-goals / follow-ups

- **Virtualized drag-reorder in admin** — pass 2 (needs dnd-kit + windowing work).
- **Infinite scroll / server pagination** — separate concern; this windows an
  already-fully-fetched list. (If galleries ever exceed what's reasonable to fetch at
  once, server-side pagination becomes its own proposal.)
- **`content-visibility: auto`** as a CSS-only fallback — considered, but it doesn't
  cut React state/handlers the way true windowing does.
