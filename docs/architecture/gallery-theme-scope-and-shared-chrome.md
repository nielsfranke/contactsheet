# Gallery theme scope & shared chrome

Status: **approved & implemented** (2026-06-13)

Make the **public client gallery** and the **admin in-gallery view** render the same chrome from
one definition, so the two stop drifting. Driven by a recurring class of bug: the public gallery
*hand-copied* the look of the admin's shadcn components (toolbar, sidebar buttons) with parallel
`zinc-*` utility classes, so every change had to be mirrored by hand and the copies diverged
(buttons ended up `h-8` vs `h-7`, `text-sm` vs `text-[0.8rem]`, `rounded-lg` vs `rounded-md`).

## Root cause

Two parallel **styling systems**:

- **Admin** is themeable — shadcn primitives (`Button`, `Input`) driven by CSS variables
  (`--primary`, `--foreground`, `--border`, light/dark + accent), see
  [admin-theming-and-gallery-redesign.md](admin-theming-and-gallery-redesign.md).
- **Public gallery** couldn't use those tokens: it has its own *per-gallery* "bright vs dark" tone
  (`bg_brightness`) and is always-dark by default, so it reinvented colors as `zinc-*` literals
  with `bright ? … : …` branches in JS.

Shared constants reduce drift but don't end it — someone still wires each constant into two places.
The fix is to make **color a value (CSS variables), not duplicated code**, so the *same* components
render on both surfaces.

## The approach — a gallery theme scope

A design-system split: **tokens** (geometry + semantic color roles, theme-agnostic) vs **themes**
(concrete values per surface, swapped via CSS variables). The admin already does this; the gallery
becomes a second *theme scope* for the same tokens.

### 1. `.gallery-scope` (in `globals.css`)

A CSS class that redefines the standard shadcn semantic tokens (`--background`, `--foreground`,
`--primary`, `--border`, `--input`, `--muted-foreground`, …) from the gallery's tone, pulled from
Tailwind's zinc ramp so the values match the previous public palette exactly:

- `.gallery-scope` → light tone (zinc-50 bg / zinc-900 fg / zinc-200 border / …)
- `.gallery-scope.dark` → dark tone (zinc-950 / zinc-100 / zinc-800 / …)

The gallery root (`GalleryView`) carries `gallery-scope text-foreground` + conditional `dark`
(`!bright`). Two reasons for the extras:

- **`.dark` class** (not just the data attribute) so shadcn's `dark:` variants
  (`dark:bg-input/30`, …) resolve inside the gallery. Specificity: `.gallery-scope.dark` (0,2,0)
  overrides both the global `.dark` and `:root` for the tokens it redefines.
  - **The root `<html>` must not force `dark` on `/g/`.** `app/layout.tsx` hard-codes
    `<html class="… dark">` and the pre-hydration script only stripped it for
    `/admin`·`/login`·`/setup`, so gallery pages kept `html.dark`. A token *value* override can't
    un-match an ancestor `.dark`, so every shadcn `dark:` variant fired inside a **bright** gallery
    (the visible symptom: a grey filter input from `dark:bg-input/30`, plus grey-filled outline
    buttons). Fix: the script now also drops `dark` on `/g/…` so the scope is the **sole** tone
    authority (bright = no `.dark` anywhere → `dark:` off; dark = `.dark` on the scope → `dark:`
    on). The pre-gallery states that render before a tone is known (password gate / expired /
    loading / not-found) keep their own dark surface — `PasswordGate` (it uses shadcn `Card`/
    `Input`/`Button`) is wrapped in `<div className="dark">`; the others use explicit `zinc-950`.
- **`text-foreground` on the root** so the scope re-applies `color` from its own `--foreground`.
  A token *variable* redefinition alone doesn't change inherited `color`; the public `<body>`
  computes to the dark foreground (white), so without this the shadcn `outline` buttons (which have
  **no base text color — they inherit**) rendered white-on-white in the bright gallery. A proper
  themed surface sets both background tokens **and** the base text color.

### 2. Shared `GalleryToolbar` (`components/gallery/GalleryToolbar.tsx`)

One toolbar (filter / flag chips / comment / sort / group / count+clear), styled entirely with
semantic tokens. Props: `arrange`, `setArrange`, `shownCount`, `totalCount`, optional `features`
(`{ colorFlags, comments }`, defaults to all → admin), and `className` for the host's positioning.

- **Admin** `components/admin/GalleryViewToolbar.tsx` is now a ~25-line wrapper:
  `<GalleryToolbar className="sticky top-0 z-20 -mx-6 -mt-6 px-6 py-2.5" />` (it bleeds into the
  page's `p-6`). Colors come from the admin theme already in scope on `/admin`.
- **Client** `GalleryView` renders the same `<GalleryToolbar className="px-4 py-2.5" features={…}/>`
  inside `.gallery-scope`; the parent container owns stickiness + the mobile bar.
- The old `GalleryClientToolbar.tsx` (161 lines of duplicated bright/dark branches) was **deleted**.

### 3. Sidebar buttons → real shadcn `<Button>`

The collaboration sidebar's Download / Add photos / Select and the entire collections panel
(Done / Select all / Clear / Save / Save-filter, list rows) now use the actual `<Button>` /
`buttonVariants` — measured byte-identical to the admin sidebar (h-7, 0.8rem, `rounded-md`, the
shadcn `size-3.5` icon). This is where the drift bugs lived; they can't drift now. `Add photos`
(the shared `ClientUploadButton`, which keeps its own icon) gets `buttonVariants({variant:"outline",
size:"sm"})` + `gap-3` so its icon spacing matches the admin's `gap-1 + mr-2` (= 12.75px).

### 4. Nav links + masthead → tokens

The sidebar surface (`border-border bg-background`), the studio masthead bands, the gallery
title/headline/reviewer badge, the nav links (`linkBase`/`activeCls`/`borderCls`/`countCls` are now
plain token strings matching the admin nav), and the sub-gallery cover cards all use semantic
tokens — no more `bright ? … : …` for sidebar chrome.

### Also in this pass

- **Masthead icon dropped** — the leading `Camera` fallback was removed from both the admin layout
  masthead and the client `StudioMasthead`; with no uploaded logo, both show just the instance
  name (same left-start position, weight, size). An uploaded logo still renders.
- **Sort label unified** — the client manual-sort option now reads **"Manual"** (was "Default"),
  matching the admin.

## Net effect

| | Before | After |
|---|---|---|
| Toolbar | 2 components, duplicated palettes | 1 shared `GalleryToolbar` + thin admin wrapper |
| `GalleryClientToolbar.tsx` | 161 lines | deleted |
| Sidebar buttons | hand-rolled geometry + `bright ? … : …` | real `<Button>`, color from scope |
| Sidebar chrome (nav/masthead/title) | bright/dark zinc ternaries | semantic tokens |
| Drift risk (the h-8-vs-h-7 class) | high — two copies | none — one definition |

## Scope / not done (intentional)

Still on `zinc-*` literals in the public gallery, because they have **no admin twin to drift
against** (so no correctness pressure) — convert opportunistically: the photo grid empty/group
states, the **presentation-mode** hero/header layouts, the save-collection dialog, the mobile menu
bars, and the loader. The `bright` boolean stays for these. `PhotoGrid` / `Lightbox` likewise keep
their own always-dark styling.
