# ContactSheet design system (conventions)

A short, living set of rules for the small visual primitives that kept drifting across surfaces.
Full rationale + history: [architecture/design-system-and-shared-chrome.md](./architecture/design-system-and-shared-chrome.md).

This is **not** a component library — it's the shadcn primitives in `components/ui/` plus a thin
project-specific layer in `components/chrome/` for the photo-overlay patterns shadcn doesn't cover,
and two registries in `lib/`.

## Rules

1. **Icons — import the concept, not the glyph.** For any concept in `lib/ui-icons.ts`, use
   `import { Icons } from "@/lib/ui-icons"` → `<Icons.annotation />`, never the raw lucide import.
   This is what stops "annotation = `PenLine` here, `Pencil` there". Raw lucide imports are fine for
   one-off icons with no cross-surface meaning (e.g. a kebab `MoreVertical`, a `Loader2` spinner).
   - Canonical mappings include: `comment` (MessageCircle), `annotation` (PenLine), `rename` (Pencil),
     `like` (Heart), `download`, `pin`, `subGallery` (Layers), `open` (ArrowUpRight), `locked` (Lock),
     `modeReview` (Users), `modeShowcase` (Presentation), `play`, `photo` (Images).

2. **On-photo chrome — use `<OverlayPill>`**, never hand-roll a `bg-black/55 …` pill.
   - `variant="control"` — interactive (button/link): hover-darkens. `variant="badge"` — read-only.
   - `size` (`xs` chip / `sm` control), `shape` (`rounded` / `pill` / `iconPill` / `circle`).
   - Polymorphic via `as` (`span` default, `button`, `a`). Opacity literals live in `lib/ui-tokens.ts`
     — don't reintroduce raw `bg-black/NN` for tiles.

3. **Photo comment/annotation counts — use `<MediaBadge img=… />`.** It owns the
   `comment_count − annotation_count` math and the canonical **bottom-right**, `xs` look. Used
   identically by the admin and client grids.

4. **Confirmation prompts — use `<ConfirmDialog>`, never `window.confirm()`.** Controlled: the parent
   owns `open`/`onOpenChange` and supplies `onConfirm` (+ `destructive`, `pending`). It's built on the
   shadcn `Dialog`, so it's themed and renders correctly inside the gallery scope.

5. **Modals in general — use the shadcn `Dialog`** (`components/ui/dialog.tsx`), controlled by the
   parent (`open`/`onOpenChange`), like `ShareDialog`/`SaveCollectionDialog`.

6. **Dropdown / kebab menus — use `<DropdownMenu>`** (`components/ui/dropdown-menu.tsx`), built on
   Base UI's `menu` (keyboard nav, focus management, portalled anchored positioning for free). Never
   hand-roll a fixed/absolute popover + full-screen click-catcher. Parts: `DropdownMenu` (Root,
   uncontrolled) · `DropdownMenuTrigger` (renders a button; pass `className`, e.g.
   `overlayPillVariants(...)` for an on-photo kebab) · `DropdownMenuContent` (`side`/`align`/
   `sideOffset`) · `DropdownMenuItem` (`destructive`, `disabled`, `onClick` — closes on click) ·
   `DropdownMenuSeparator`.

## Accent color (`--primary`)

The instance accent (Settings → Branding) drives `--primary` / `--ring` / `--primary-foreground` on
the **admin surface** (`lib/theme.ts::applyAdminTheme`). Public galleries have a *separate* identity
system (`brand_color`, footer `accent_color`) — don't reach for `--primary` there.

7. **One accent emphasis per view.** Use accent for the *primary* action in a group (`Button` default
   variant), focus rings (`--ring`), the active state of nav/tabs, and key inline links (`link`
   variant). If two things are accent, neither reads as primary.

8. **Don't use accent for:** large background fills or page chrome, body/label text, success or
   **destructive** actions (those keep `--destructive` / status colors — accent ≠ status), or to
   recolor icons that carry their own meaning (color flags, mode chips).

9. **On an accent fill, always pair `--primary-foreground`** for text/icons — never hard-code white.
   `accentForeground()` already guarantees WCAG contrast for any picked hex.

10. **Accent is theme-independent** — the same hex rides both light and dark admin themes, so anything
    accent-colored must read on both. The optional gradient (`accent_gradient`, Branding) is derived
    from the single accent via `color-mix(in oklab, …)` and is scoped to **primary CTAs only** — not
    small/dense buttons, outline/ghost variants, badges, or text.

## Lightbox backdrops

The lightbox backdrop is a per-instance setting (`lightbox_backdrop` ∈ `dimmed` · `black` · `white`
· `transparent`) that is **independent** of the gallery's bright/dark tone — a gallery can be dark but
open photos on a white backdrop. So lightbox chrome can't assume "always dark."

11. **Lightbox chrome takes its tone from `lightboxTones(backdrop)`** (`lib/lightbox-theme.ts`) — the
    single source mapping a backdrop to `{ surface, muted, strong, borderTone, faint, chipBg, panel,
    body, rowHot, field, … }`. `white`/`transparent` are the **light** backdrops (dark text);
    `black`/`dimmed` keep light-on-dark chrome. `Lightbox` computes `tones` once and passes the object
    down to every sub-panel (`CommentPanel`, `AnnotationLayer` note popover).

12. **Never hard-code `zinc-*` (or any fixed light/dark value) in lightbox chrome** — including the
    comment panel, the name/comment inputs, and the annotation popover. Pick from the passed `tones`
    so a light backdrop never leaves a black panel/field stranded on white. Colored, on-photo marks
    (flag dots, annotation strokes, numbered badges) are exempt — they read over the image, not the
    backdrop.

## i18n

`ConfirmDialog` defaults pull `common.confirm` / `common.cancel`; pass explicit `confirmLabel` for
verbs like delete (`common.delete` exists). Run `cd frontend && node scripts/validate-i18n.mjs` after
catalog edits.

## Known intentional exceptions

Surfaces still on raw zinc/black literals because they have no cross-surface twin (so no drift risk):
presentation-mode hero/header layouts, the save-collection dialog, `ReviewerNamePrompt`, mobile menu
bars, the loader. See the architecture doc's follow-ups to fold these in if they grow twins.

The **annotation note popover** (`AnnotationLayer.tsx`) is a deliberate special case: it's an *inline
popover anchored to the drawn mark* (not a centered modal, so not a `ConfirmDialog`/`Dialog`), and it
lives on the lightbox's always-dark surface — so it uses the same zinc literals as its sibling
`CommentPanel`, not semantic tokens (which follow the gallery's bright/dark tone and would mismatch
the dark lightbox). A shared anchored-Popover primitive is a possible future consolidation.
