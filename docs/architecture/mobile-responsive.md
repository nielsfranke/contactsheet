# Mobile Responsiveness

Status: **approved & implemented** (2026-06-13)

> **Implementation note:** the plan below proposed a Base UI `Sheet` + `useIsMobile()` hook. During
> implementation a simpler, more robust approach was chosen: a **single always-mounted `<aside>`**
> that is a static column at `md+` and a CSS off-canvas drawer (`max-md:fixed` + `translate-x`)
> below `md`, toggled by a boolean. A Base UI Sheet creates a *separate* element from the desktop
> aside, which would mean two copies of the detail page's portal slot id (`#gallery-admin-sidebar-slot`)
> and a stale-target bug when the viewport crosses the breakpoint. Keeping one element that simply
> restyles per breakpoint means the slot never unmounts or changes identity, so the existing
> `SidebarPortal` works untouched — and no `Sheet`/`useIsMobile` was needed. Sections 1–2 describe
> the original plan; §1 is superseded by this note.

Make the whole app usable on phones. Today the **content** reflows (photo grids use responsive
`grid-cols-*`, the Next default viewport meta is present), but the **chrome** doesn't: two
permanently-pinned fixed-width sidebars eat the screen below tablet width.

Audit (390px phone, screenshots in the review thread):

| Surface | State | Cause |
|---|---|---|
| Public **presentation** gallery | ✅ Good | full-bleed, already responsive |
| Public **collaboration** ("review") gallery | ❌ Cramped | `aside w-64` sticky, never collapses → photos in a ~130px column |
| **Admin** (overview / detail / settings) | ❌ Unusable | `aside w-72` (288px) pinned → content in a ~100px sliver |

Root cause: **no responsive navigation strategy anywhere** — no drawer, hamburger, media-query
hook, or off-canvas primitive. Both sidebars are always-on flex children with hard-coded widths.

Goal: below the `md` breakpoint (768px), both sidebars become a **left off-canvas drawer** behind a
trigger; at/above `md` everything is exactly as it is today. Presentation mode is untouched.

---

## 1. Shared infrastructure (new)

### `components/ui/sheet.tsx` — off-canvas panel
Built on the existing `@base-ui/react/dialog` (same primitive `ui/dialog.tsx` already uses — **no
new dependency**). A left-anchored, full-height sliding panel: `Backdrop` (dim + dismiss) + `Popup`
(`fixed inset-y-0 left-0 w-[84vw] max-w-xs`, slide-in via `data-[state]` / `tw-animate-css`). Mirrors
shadcn's Sheet API (`Sheet`/`SheetTrigger`/`SheetContent`) so call sites read normally. Reused by
both the admin shell and the public collaboration view.

### `lib/use-media-query.ts` — `useIsMobile()`
`matchMedia("(max-width: 767px)")`, SSR-safe (returns `false` on the server / first paint, updates on
mount + on change). **Why a JS hook and not pure Tailwind `md:` classes:** the gallery detail page
injects its sidebar through a React **portal into a single DOM slot id**
(`#gallery-admin-sidebar-slot`). Rendering the sidebar twice (a `hidden md:flex` desktop copy + a
mobile copy) would create two elements with the same id — the portal would target the hidden one on
mobile. So we render the sidebar **once** and branch its *container* (static `<aside>` vs `<Sheet>`)
on `useIsMobile()`. One instance → one slot → the portal keeps working.

---

## 2. Admin shell — `app/admin/layout.tsx`

The sidebar's inner content (logo header · body [`GalleryTree` | `#gallery-admin-sidebar-slot` |
settings nav] · footer [Settings · Sign out]) is extracted into a single `SidebarContents` element so
it renders once regardless of container.

- **Desktop** (`!isMobile`): the current `<aside className="w-72 …">{SidebarContents}</aside>`,
  unchanged.
- **Mobile** (`isMobile`): a slim sticky **top bar** (`h-14`, border-b, bg-sidebar) with a hamburger
  (`Menu` icon) + the logo/instance name. The hamburger opens a `<Sheet>` rendering the same
  `SidebarContents`. `main` is full-width beneath it.
- **Auto-close**: an effect on `usePathname()` + `useSearchParams()` closes the drawer on navigation,
  so tapping a tree node (or "All Galleries") drills in *and* dismisses the drawer.
- Theming: the Sheet uses the same `bg-sidebar` / `text-sidebar-foreground` tokens, so admin
  light/dark carries over.

This one change fixes the **overview, detail, and settings** pages at once — all three render their
sidebar through this shell (the detail page via `SidebarPortal`, settings via the section nav).

---

## 3. Admin overview header — `app/admin/galleries/page.tsx`

Small spot-fixes for narrow widths:
- Title/breadcrumb + filter row → `flex-col sm:flex-row`; filter `Input` → `w-full sm:w-64`.
- Actions row (Create · Organize · Sort) → add `flex-wrap` so it stacks instead of overflowing.
- The grid already reflows (`GRID_COLS`), so cards are fine once the sidebar is out of the way.

---

## 4. Public collaboration view — `components/gallery/GalleryView.tsx`

- Extract the `<aside>…</aside>` body (filter · arrangement · collections · flags …) into a
  `sidebarBody` element.
- **Desktop**: the existing sticky `aside w-64`, unchanged.
- **Mobile**: a **"Filters & tools"** trigger (sliders icon) placed in the header strip; a `<Sheet>`
  renders `sidebarBody`. The photo grid (already `flex-1`) takes the full width once the aside is
  gone. The Sheet respects the gallery's `bg_brightness` (reuse the existing `bright` token vars so
  it themes light/dark like the inline sidebar).
- **Presentation** mode: no change (already mobile-friendly).

---

## 5. Audit pass (spot-fixes, not rewrites)

- **Dialogs/modals** (`GallerySettingsModal` is the widest — tabbed): ensure popups use
  `w-[calc(100vw-2rem)]` + a `max-w-*` so they fit a phone; tabs scroll/wrap rather than overflow.
  Most Base UI dialogs already cap width; this is a verify-and-patch, not a redesign.
- **Lightbox** (`components/gallery/Lightbox.tsx`): verify open/close/next/prev and image fit at
  phone width (touch targets ≥ 40px); patch control sizing/hit-area only if needed. *(2026-06-15:
  added swipe gestures + bumped flag/like touch targets — see §6.)*
- **Detail page canvas**: header-image strip + `AdminImageGrid` already responsive; confirm the
  cover-picker dialog (`grid-cols-4`) and the drag overlay (`w-40`) are acceptable on mobile.

---

## 6. Scope & non-goals

- **In**: responsive chrome for admin (shell → overview/detail/settings) + public collaboration;
  the `Sheet` + `useIsMobile` primitives; header/dialog/lightbox spot-fixes.
- **Out**: redesigning any view for mobile beyond "usable" (no mobile-specific layouts, no bottom
  tab bars); presentation mode (already good).
- **Done later (2026-06-15)**: lightbox swipe gestures (finger-follow horizontal prev/next +
  vertical-down dismiss) and bigger flag/like touch targets on mobile — the two items §5 left as
  follow-ups. See the "Lightbox touch" note in CLAUDE.md.
- No backend, no API, no migration. Purely frontend layout/components.

---

## 7. Implementation checklist — as built

1. **`app/admin/layout.tsx`**: single `<aside>` (the `sidebarInner` content rendered once) that is a
   static `w-72` column at `md+` and a `max-md:fixed` off-canvas drawer (`translate-x` on a
   `drawerOpen` boolean) below `md`; a `md:hidden` top bar with a hamburger; a `md:hidden` backdrop;
   Esc-to-close; and a `<Suspense>`-wrapped `CloseDrawerOnNav` (reads `usePathname`+`useSearchParams`)
   that closes the drawer on any navigation incl. `?folder=`. Fixes overview + detail + settings at
   once. The portal slot stays a single stable element, so `SidebarPortal` is unchanged.
2. **`app/admin/galleries/page.tsx`**: header stacks (`flex-col sm:flex-row`), filter `w-full sm:w-64`,
   actions row `flex-wrap`, padding `p-4 sm:p-6`.
3. **`components/gallery/GalleryView.tsx`** (collaboration only): the `<aside>` becomes the same
   single-element drawer (`md:sticky` column / `max-md:fixed` drawer, themed to `bright`); a
   `md:hidden` "Filters & tools" bar opens it; backdrop + in-drawer close button; grid is full-width
   on mobile. Presentation mode untouched.
4. **Audit (no code needed)**: `GallerySettingsModal` already caps width (`max-w-[calc(100%-2rem)]`)
   and scrolls its body (`max-h-[55vh] overflow-y-auto`); the lightbox is structurally fine on phones
   (flag buttons are slightly small — noted, not changed).
5. **Verified**: 390px Playwright screenshots of overview, drawer open, auto-close-on-nav, detail
   (sidebar via portal in the drawer), settings, public collaboration (+ tools drawer), and lightbox.
   `npm run lint` (no new problems) + `npm run build` pass; `/admin/galleries` still prerenders.

No `Sheet`/`useIsMobile`/Base UI primitive was added (see the implementation note at the top).
