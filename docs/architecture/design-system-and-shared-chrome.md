# Design system & shared chrome

Status: **implemented** 2026-06-15. No migration (frontend-only).

A lightweight, app-wide standard for the small visual primitives that keep getting re-implemented
slightly differently across surfaces. This is **not** Storybook or a component-library rewrite — the
hard foundation already exists (semantic theme tokens from
[gallery-theme-scope-and-shared-chrome.md](./gallery-theme-scope-and-shared-chrome.md), shadcn
primitives in `components/ui/`). The gap is three recurring *micro-patterns* that have no single
definition and have drifted, plus the iconography itself.

## Why now — the drift is measurable

Four user-reported inconsistencies all trace back to the same root cause (no shared primitive):

1. **Delete confirm dialogs use native `window.confirm()`** — the only two left in the app
   (`CommentPanel.tsx:91`, `Lightbox.tsx:225`). Every other modal uses shadcn `Dialog`
   (`ShareDialog`, `CreateGalleryDialog`, `SaveCollectionDialog`, settings). Native confirm can't be
   themed, can't be translated beyond the message string, and looks foreign.

2. **Client comment badge opens a plain lightbox** — `PhotoGrid.tsx:361` calls `open(images, i)`;
   the lightbox's `showComments` always defaults to `false` (`Lightbox.tsx:92`). Clicking "comments"
   doesn't show comments. There's no annotation affordance in the client hover toolbar at all, only a
   passive count.

3. **Admin vs client count badges are the same thing, drawn differently:**

   | | Admin tile (`admin-grid-tile.tsx:144`) | Client (`PhotoGrid.tsx:290`) |
   |---|---|---|
   | Annotation icon | `Pencil` | `PenLine` |
   | Position | top-left | bottom-right |
   | Icon size / padding | 9px, `px-1` | 10px, `px-1.5 py-0.5` |

4. **All-Galleries cards hand-roll their own pills** (`overview-parts.tsx`) — Pin, Open
   (`ArrowUpRight`), sub-gallery count (`Layers`), mode chip (`Users`/`Presentation`), `Lock` — a
   *second* implementation of the photo-overlay pill family.

The overlay-pill opacity drift is the clearest evidence. Across the codebase:

- **Control pills** (download / comment / kebab buttons): `bg-black/55` at rest → `bg-black/75` on
  hover — in PhotoGrid, admin-grid-tile, **and** overview-parts (three copies).
- **Count badges** (read-only): `bg-black/60` — also three copies.
- **Overview cards**: a one-off `bg-black/45` scrim and `bg-black/55` pills.

Same intent, three to four literal values. Add a fifth surface and it drifts again. The semantic-token
work already proved the fix pattern for ContactSheet: **one definition, many consumers.**

## Non-goals

- No Storybook, no design-token JSON pipeline, no Figma sync. This is a handful of React primitives +
  one registry module + one conventions page.
- No change to the shadcn `components/ui/` primitives themselves — those are the standard; this layer
  sits *on top* for the photo-overlay / status-icon patterns shadcn doesn't cover.
- No backend or schema change.

## The three primitives

All live in a new `frontend/src/components/ui/` (shadcn-adjacent) or
`frontend/src/components/chrome/` directory — TBD during implementation; `chrome/` keeps the
project-specific overlay stuff visually separate from vendored shadcn.

### 1. `<OverlayPill>` — translucent controls over media

The single definition of the dark glassy pill used for every on-photo control and badge. Variants
cover both the interactive (button) and passive (badge) cases so opacity/size/padding can never
drift again.

```tsx
<OverlayPill as="button" variant="control" size="sm" onClick={…}><Download/> Download</OverlayPill>
<OverlayPill variant="badge" size="xs"><Pencil/> {count}</OverlayPill>
```

- `variant="control"` → `bg-black/55 hover:bg-black/75 text-white transition-colors` (the canonical
  button look). `variant="badge"` → `bg-black/60 text-zinc-200 pointer-events-none` (read-only).
- `size` standardizes the height/padding/icon-size pairs (`xs` = current badge 9–10px, `sm` = the
  `h-7 px-2` control). Picks **one** value per size — resolving the 9-vs-10px and `/55`-vs-`/45`
  splits.
- Shape: `rounded-full` for standalone controls, `rounded` (`md`) for count chips — encoded by
  variant, not chosen per call site.

Consumers: `PhotoGrid` (download/like/comment/kebab + counts), `admin-grid-tile` (download/kebab +
counts + client-upload badge + play badge), `overview-parts` (pin/open/mode/`Layers` + comment
count). The video **play badge** (`bg-black/55` circle, duplicated verbatim in both grids) folds in
as `<OverlayPill variant="control" shape="circle">`.

### 2. `<ConfirmDialog>` — themed confirm built on shadcn `Dialog`

Replaces both `window.confirm` calls. **Controlled** (decided 2026-06-15): the parent owns the open
state and passes `onConfirm`, matching every other dialog in the app (`ShareDialog`,
`SaveCollectionDialog` all take `open`/`onOpenChange`). No `useConfirm()` provider/promise plumbing.

```tsx
<ConfirmDialog
  open={confirming}
  onOpenChange={setConfirming}
  title={t("deleteTitle")}
  description={t("deleteConfirm")}
  confirmLabel={tc("delete")}
  destructive
  pending={deleteMutation.isPending}
  onConfirm={() => deleteMutation.mutate(target.id)}
/>
```

Built on the existing `Dialog`/`DialogContent`/`DialogFooter` primitives with `buttonVariants`
(`destructive` flag → destructive confirm button). It renders inside the `Dialog` portal, which is
already under the gallery scope, so the public-gallery delete (a client removing their own comment)
is themed like the rest of the gallery chrome.

### 3. `<MediaBadge>` — the unified comment/annotation count badge

A thin wrapper over `OverlayPill variant="badge"` that renders the annotation + plain-comment count
pair from an `ImageResponse`, used **identically** by admin and client tiles. Encapsulates the
`comment_count - annotation_count` "plain comments" math (currently duplicated and easy to get
wrong) and the icon choice (from the registry below).

**Canonical look (resolving question #3):** **bottom-right** position, icon size `xs`, the client's
current geometry. Rationale: the photo overlay's *interactive* controls already cluster
bottom-left/right; counts belong with them, and the admin top-left slot collides with the selection
checkbox (`top-2 left-2`) in selection mode. Admin tiles move their badge from top-left to
bottom-right to match.

## Icon & token registry — `lib/ui-icons.ts` + `lib/ui-tokens.ts`

One source of truth mapping **concept → icon**, so "annotation" is never `Pencil` in one place and
`PenLine` in another, and `Pencil` is freed up for its other meaning (rename/edit). Mirrors the
proven pattern of `gallery-fonts.ts` (a registry that every consumer reads).

```ts
// lib/ui-icons.ts  (re-exports lucide; the app imports concepts, not raw glyphs)
export const Icons = {
  comment:    MessageCircle,
  annotation: PenLine,      // canonical — replaces Pencil-as-annotation in admin
  rename:     Pencil,       // Pencil now means "edit/rename" only
  like:       Heart,
  download:   Download,
  pin:        Pin,
  subGallery: Layers,
  open:       ArrowUpRight,
  locked:     Lock,
  modeReview: Users,
  modeShowcase: Presentation,
  showAnnotations: Spline,  // the lightbox reveal toggle
  …
};
```

`lib/ui-tokens.ts` (or CSS custom props) holds the overlay opacity/scrim constants the `OverlayPill`
variants consume (`OVERLAY_REST = "bg-black/55"`, `OVERLAY_HOVER = "bg-black/75"`,
`BADGE_BG = "bg-black/60"`, `SCRIM = "from-black/50 via-transparent to-black/30"`). The photo-overlay
gradient scrim is itself duplicated with small variations (`/50…/30` vs `/45`) and folds in here.

**Convention:** new code imports `Icons.annotation`, never `PenLine` directly, for any of the
registered concepts. Raw lucide imports stay fine for one-off icons with no cross-surface meaning.

## Lightbox open-intent (resolves #2)

Extend the zustand store so a click can express *what to show*:

```ts
type LightboxIntent = { panel?: "comments" | "annotations" };
open: (images: ImageResponse[], index: number, intent?: LightboxIntent) => void;
```

The `Lightbox` mounts fresh on open (`{isOpen && <Lightbox/>}` on both the public and admin surfaces),
so it simply **seeds** `showComments` / `showAnnotations` from `intent.panel` in their `useState`
initializers (replacing the hard `useState(false)`); the annotations panel implies comments. Then:

- The client tile's hover toolbar gained a **comment** `OverlayPill` (passes `{ panel: "comments" }`)
  and a **new annotation** `OverlayPill` next to it (`Icons.annotation`, passes
  `{ panel: "annotations" }`) — gated by `features.comments` / `features.annotations`. These are the
  unified entry points the user asked for. The passive `MediaBadge` stays a non-interactive indicator
  (hidden on hover where the buttons take over), matching the existing client pattern.
- `Lightbox` seeds its panel state from the intent in its `useState` initializers (it mounts fresh
  per open), so no effect and no cascading-render lint.

**Admin tiles:** also wired. The passive `MediaBadge` look is unified, and the hover overlay gained
comment + annotation `OverlayPill`s grouped with the kebab at bottom-right; clicking opens the admin
lightbox straight to that panel. Intent is threaded `onOpen(img, intent?)` → `openPreview` →
`openLightbox` (`CardProps.onOpen` / `AdminImageGrid` prop widened).

No new endpoint — the lightbox already loads comments itself (shared query key with `CommentPanel`).

## Rollout (incremental — each step ships independently)

1. **Primitives + registry** — add `OverlayPill`, `ConfirmDialog`/`useConfirm`, `MediaBadge`,
   `ui-icons.ts`, `ui-tokens.ts`. No behavior change yet.
2. **Quick wins** — swap the two `window.confirm` → `ConfirmDialog`; add lightbox open-intent + the
   client annotation affordance. (These are the highest user-visible value and don't depend on the
   full pill refactor.)
3. **Badge unification** — replace the bespoke count badges in `admin-grid-tile` + `PhotoGrid` with
   `MediaBadge`.
4. **Pill migration** — convert the control pills in `PhotoGrid`, `admin-grid-tile`, `overview-parts`
   (download/like/kebab/pin/open/mode/play badge) to `OverlayPill`. This is the largest mechanical
   step and pure refactor (no visual change once tokens match the current canonical `/55`→`/75`).
5. **Conventions page** — `docs/design-system.md`: the icon table, the pill variants, "use
   `ConfirmDialog` not `window.confirm`", "import from `Icons`, not lucide, for registered concepts".
   Linked from `CLAUDE.md` and `AGENTS.md`.

## i18n

The two confirm dialogs already have message keys (`*.deleteConfirm`); `ConfirmDialog` needs
`common.confirm` / `common.cancel` (likely already present) plus per-call title/body keys. Run
`node scripts/validate-i18n.mjs` after adding any.

## Follow-ups (out of scope)

- Migrating the remaining ad-hoc dark overlays (`SaveCollectionDialog` `bg-black/80`,
  `ReviewerNamePrompt`, mobile menu scrims) onto shared scrim tokens.
- A `<StatusChip>` for the non-photo status pills (gallery mode, lock) if more surfaces appear.
- Documenting spacing/typography scale beyond what Tailwind + shadcn already give.

## Implemented files

- `lib/ui-icons.ts` — concept→icon registry (`Icons`).
- `lib/ui-tokens.ts` — overlay opacity/scrim constants.
- `components/chrome/OverlayPill.tsx` — the on-photo pill (cva `overlayPillVariants` + `<OverlayPill>`).
- `components/chrome/ConfirmDialog.tsx` — controlled themed confirm (replaces `window.confirm`).
- `components/chrome/MediaBadge.tsx` — unified comment/annotation count badge.
- `store/lightbox.ts` — `open(images, index, intent?)` + `intent`.
- Consumers refactored: `PhotoGrid.tsx`, `admin-grid-tile.tsx`, `overview-parts.tsx`,
  `CommentPanel.tsx`, `Lightbox.tsx`.
- Conventions: `docs/design-system.md` (linked from `CLAUDE.md`).
