<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Mobile gallery up-navigation + toolbar one-liner

Status: proposed (2026-06-17)

## Problem

On the **public client gallery**, getting from a sub-folder back to its parent on a phone is
unintuitive:

- **Showcase (presentation) mode** only offers the `GalleryBreadcrumb` row — a horizontal trail
  that reads as decoration, not as a tappable "go up" action.
- **Review (collaboration) mode** does have a parent link (the eyebrow link + sub-gallery tree in
  `CollabSidebar`), but on mobile that whole sidebar is hidden behind the "Filters & tools"
  off-canvas drawer, so there is no visible way up without first opening the drawer.

The only other ways up are the browser/OS back gesture or tapping a breadcrumb crumb — neither is
obvious to a client.

Separately, in the shared `GalleryToolbar`, the fixed-width (`w-56`) filename filter pushes the
color-flag chips onto a second line on a phone, wasting vertical space (see screenshot).

## Decision

Two independent, frontend-only changes (no backend, no migration). All data needed is already on
`GalleryPublicResponse`: `parent_name`, `parent_share_token`, `name`.

### 1. Shared mobile "up" bar — `GalleryUpNav`

A slim, **mobile-only** (`md:hidden`), sticky bar shown at the very top of the gallery. The component
takes a generic `{ label, href }` (renders nothing when either is null), so it is reused by the
public gallery **and** the admin in-gallery view. One shared component used by **both** public
layouts:

```
┌──────────────────────────────┐
│  ‹  Wedding 2026             │  ← tap = /g/{parent_share_token}
└──────────────────────────────┘
```

- A back chevron (`ChevronLeft`) + the **parent folder's name** (`parent_name`), rendered as a
  `next/link` to `/g/{parent_share_token}`. Truncates on overflow.
- Styled with the gallery scope's semantic tokens via the same band treatment as the toolbar
  (`bg-background/95 backdrop-blur`, bottom border) so it reads correctly over a Showcase hero image
  and in both light/dark gallery tones. Lives in `frontend/src/components/gallery/GalleryUpNav.tsx`.
- New i18n key `gallery.view.backTo` (`"{name}"` is the parent) — actually rendered as just the
  parent name with a chevron, so no interpolation string is strictly required; we reuse a plain
  `aria-label` key `gallery.view.upToParent` for screen readers.

**Placement** (mobile only, sticky at viewport top):

- **Review mode** (`GalleryCollabLayout`): inserted as the first child of the existing
  `sticky top-0 z-30` stack, above the mobile menu bar — so up-bar → menu bar → toolbar scroll and
  stick together as one block.
- **Showcase mode** (`GalleryPresentationLayout`): rendered before the hero/standard header as
  `md:hidden sticky top-0 z-40`. Presentation mode has no other sticky bar, so it owns the top.

Desktop is unchanged: the breadcrumb (Showcase) and `CollabSidebar` parent link (Review) already
work well there, so the bar is `md:hidden`. The component returns `null` when there is no parent
(top-level gallery), so nothing renders there.

Wired in `GalleryView`: build a single `upNav` node and pass it as a slot to both layouts (mirrors
how `breadcrumb` / `subGalleryCards` / `photoGrid` are passed today). Immediate parent only — the
full ancestor trail stays the breadcrumb's job.

**Showcase breadcrumb on mobile** — when the breadcrumb carries no child sub-gallery links (pure
`ancestors → current`) it is now `max-md:hidden`, because the up-nav + the gallery heading already
convey that on a phone. It stays on mobile when it has sub-gallery links the up-nav can't show, and
is unchanged on desktop.

**Admin in-gallery view** — the gallery detail page (`app/admin/galleries/[id]/page.tsx`) renders the
same `GalleryUpNav` right after the portalled sidebar: up = the **parent gallery's detail page**, or
the **galleries overview** (`/admin/galleries`, labelled `admin.shell.allGalleries`) for a top-level
gallery — so it always shows on mobile, mirroring the sidebar's parent eyebrow / "All Galleries"
links which are otherwise buried in the off-canvas drawer. The detail page's sticky
`GalleryViewToolbar` offsets its mobile sticky top to `top-10` (≈ the up-nav height) so the two stack
instead of overlapping; at `md+` the up-nav is hidden and the toolbar returns to `top-0`.

### 2. Filter + color flags on one line (mobile)

In `GalleryToolbar`, change the filename filter wrapper from the fixed `w-56` to
`flex-1 min-w-0 sm:flex-none sm:w-56`. On a phone the input then shrinks to share the first row with
the (fixed-width) flag chips + comments toggle; at `sm+` it returns to its current fixed width. The
sort/group cluster keeps `sm:ml-auto` and wraps to its own line on mobile as it does now. No other
toolbar change.

This affects both the public client gallery and the admin in-gallery view (same shared toolbar),
which matches the admin screenshot that prompted it.

## Out of scope

- Desktop changes to the breadcrumb or sidebar.
- Multi-level "up" (jump several ancestors at once) — that remains the breadcrumb's role.
- Swipe-back gestures (explicitly dropped in favor of a visible control).
