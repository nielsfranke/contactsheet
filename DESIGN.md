---
name: ContactSheet
description: Self-hosted photo delivery — a warm, quiet frame that lets the photographs do the talking.
colors:
  paper-white: "oklch(1 0 0)"
  off-white: "oklch(0.985 0 0)"
  soft-gray: "oklch(0.97 0 0)"
  hairline-gray: "oklch(0.87 0 0)"
  ring-gray: "oklch(0.62 0 0)"
  mid-gray: "oklch(0.47 0 0)"
  light-gray: "oklch(0.708 0 0)"
  charcoal: "oklch(0.269 0 0)"
  ink: "oklch(0.205 0 0)"
  near-black: "oklch(0.145 0 0)"
  signal-red: "oklch(0.577 0.245 27.325)"
typography:
  body:
    fontFamily: "Montserrat, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontFamily: "Montserrat, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  label:
    fontFamily: "Montserrat, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  control-x: "10px"
  card-sm: "12px"
  card: "16px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.off-white}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "oklch(0.205 0 0 / 0.8)"
    textColor: "{colors.off-white}"
  button-outline:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.near-black}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.near-black}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive:
    backgroundColor: "oklch(0.577 0.245 27.325 / 0.1)"
    textColor: "{colors.signal-red}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.near-black}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  card:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.near-black}"
    rounded: "{rounded.xl}"
    padding: "16px"
  overlay-pill-control:
    backgroundColor: "rgba(0, 0, 0, 0.55)"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    height: "28px"
    padding: "0 8px"
  overlay-pill-badge:
    backgroundColor: "rgba(0, 0, 0, 0.6)"
    textColor: "#e4e4e7"
    rounded: "4px"
    padding: "2px 6px"
---

# Design System: ContactSheet

## Overview

**Creative North Star: "The Contact Sheet"**

The whole system answers to the darkroom contact sheet — the single evenly-lit page of frames a photographer studies to pick the keepers. Everything the app draws is that page: a warm, unhurried, craftsmanlike surface whose only ambition is to present photographs honestly and get out of the way. The interface is achromatic on purpose; the photographs supply the color, and the one chromatic voice in the chrome — the accent — belongs to the photographer, not to the app. Marks made on photos (flags, likes, drawn annotations, star ratings) are the digital grease pencil: small, legible, sitting on translucent-black chrome directly over the image.

Components are **soft and friendly**: generously rounded (10px base radius), compact but never cramped, with gentle hovers and a one-pixel press. Nothing shouts, nothing glosses. Density is calm working density, not pro-tool cockpit density — a non-technical client on a phone must feel welcomed by the same surfaces a photographer works in daily. There are two rooms in this house, deliberately separate: the admin surface (theme-able light/dark, photographer-picked accent) and the public gallery (its own zinc-ramp tone scope carrying the *photographer's* branding, fonts, and colors — the app's identity recedes to a legal strip).

**Key Characteristics:**
- Achromatic OKLCH gray chrome; photographs and the photographer's accent are the only color.
- Soft, friendly geometry: 10px-radius controls, 14px-radius cards, full-round pills over photos.
- Flat by default: hairline rings and tonal steps instead of drop shadows.
- Two separate identity scopes — admin theme vs. `.gallery-scope` — that never bleed into each other.
- Everything rem-based off a 17px root, so the whole UI scales as one piece.

## Colors

An achromatic gray ramp rendered in OKLCH, bracketed by Paper White and Near Black, with a single runtime accent and one reserved status red.

### Primary
- **Instance Accent** (runtime variable; defaults to Ink, `oklch(0.205 0 0)`): the photographer picks it in Settings → Branding. It drives `--primary`, `--ring`, and the derived `--primary-gradient`, and appears only as the one emphasis in a view — the primary action, focus rings, active nav/tab, key inline links. `accentForeground()` picks near-black or off-white text automatically; never hard-code white on an accent fill.

### Neutral
- **Paper White** (oklch(1 0 0)): admin light background and card surface — the contact sheet's paper.
- **Off White** (oklch(0.985 0 0)): text/icons on dark or accent fills; the dark theme's foreground.
- **Soft Gray** (oklch(0.97 0 0)): secondary/muted/hover fills in light mode — a whisper of a surface.
- **Hairline Gray** (oklch(0.87 0 0)): light-mode borders and input strokes.
- **Ring Gray** (oklch(0.62 0 0)): the neutral focus ring when no accent overrides it.
- **Mid Gray** (oklch(0.47 0 0)): light-mode muted text — deliberately darker than the shadcn stock value to clear AA comfortably.
- **Light Gray** (oklch(0.708 0 0)): dark-mode muted text, tuned to roughly the same ~7:1 contrast.
- **Charcoal** (oklch(0.269 0 0)): dark-mode secondary/muted surfaces.
- **Ink** (oklch(0.205 0 0)): default primary; dark-mode card/popover surface.
- **Near Black** (oklch(0.145 0 0)): light-mode text; dark-mode page background.

### Tertiary
- **Signal Red** (oklch(0.577 0.245 27.325); dark mode oklch(0.704 0.191 22.216)): destructive actions only. Rendered as a tinted fill (10% background, full-strength text), not a solid red slab.

### Named Rules
**The Two Darkrooms Rule.** The admin surface and the public gallery run separate identity systems. Admin: semantic tokens + the instance accent (`--primary`). Public gallery: the `.gallery-scope` zinc ramp (bright or dark tone per gallery) plus the *photographer's* `brand_color` and fonts. Never reach for `--primary` inside a public gallery, and never leak gallery branding into admin chrome.

**The One Voice Rule.** At most one accent emphasis per view. Accent never colors large fills, body text, success/destructive states, or icons that carry their own meaning (color flags, mode chips). If two things are accent, neither reads as primary.

**The Borrowed Chroma Rule.** Chrome stays achromatic. All other color on screen is borrowed — from the photographs or from the photographer's chosen accent/branding. Adding a new decorative hue to the system is a design error, not a variation.

## Typography

**Display Font:** per-gallery opener font (an 18-family self-hosted registry — from Inter to Abril Fatface to Pinyon Script, plus accessibility faces like OpenDyslexic and Atkinson Hyperlegible), chosen by the photographer per gallery
**Body Font:** Montserrat (with Helvetica Neue → Helvetica → Arial fallback)
**Label/Mono Font:** Geist Mono

**Character:** Montserrat's rounded geometry keeps the chrome warm and approachable without competing with photographs; display personality is delegated entirely to the photographer's per-gallery opener choice. The app itself has no display face.

### Hierarchy
- **Title** (500, 1rem, leading-snug): card titles, dialog headings, gallery names in admin.
- **Body** (400, 0.875rem / `text-sm`, ~1.45): the default working size for nearly all UI text.
- **Label** (500, 0.75rem): form labels, metadata, toolbar captions.
- **Overlay label** (500, 10–11px): text inside on-photo pills and badges — the grease-pencil scale.
- **Mono** (Geist Mono, 0.875rem): filenames, tokens, technical values.

### Named Rules
**The Opener Exception Rule.** Display typography exists in exactly one place: the public gallery opener, drawn from the font registry (`lib/gallery-fonts.ts`, literal option objects, `preload: false`). App chrome never borrows a display face, and new fonts enter only through the registry (synced with the backend `FontType` gate).

**The Seventeen-Pixel Rule.** The root font-size is 106.25% (17px; 118.75% ≥ 2200px viewports) and everything is rem-based, so the whole UI scales together. Size new type in rem/Tailwind steps — hard px only for the 10–11px overlay-pill scale that must hug photo chrome.

## Layout

Calm working density on an 8-based rhythm: controls are 32px tall (`h-8`, with 28px/24px compact steps), horizontal control padding 10px, card padding 16px (12px for `size="sm"` cards), grid gaps in Tailwind steps. Admin pages pair a content column with a single `<aside>` sidebar that becomes an off-canvas drawer below `md` (one element, portal-filled — never duplicated per breakpoint). Public galleries are mobile-first: grids reflow to a single column, the lightbox is a native scroll-snap swipe carousel. Photo grids are the densest surfaces by design — the contact sheet itself — and everything around them loosens up.

Stacking is a fixed ladder, not invented per feature: z-10 in-content overlays (slides, chevrons, tile chrome) → z-20 sticky page toolbar → z-30 sticky collab-sidebar band → z-40 drawer/dialog backdrops → z-50 modal layer (dialogs, lightbox, drawer) → z-[60] the download dialog that must sit above the lightbox.

**The Ladder Rule.** New stacking contexts land on an existing rung of the z-index scale. No in-between values.

## Elevation & Depth

Flat by default. Surfaces at rest carry no shadows; separation comes from a one-pixel hairline ring (`ring-1 ring-foreground/10` on cards), tonal steps between background / soft-gray / card, and — over photographs — translucent-black scrims. A soft shadow on genuinely floating layers (popovers, dialogs) is acceptable when warranted, but is the exception that proves the flat rule, never a resting treatment for cards or page chrome.

### Shadow Vocabulary
- **Hairline ring** (`ring: 1px foreground at 10%`): the standard card/container separator in both themes.
- **Photo scrim** (`linear-gradient(to top, rgba(0,0,0,0.5), transparent, rgba(0,0,0,0.3))`): laid under a tile's hover controls so white pill text stays legible on any photograph.

### Named Rules
**The Hairline Rule.** Depth is drawn, not cast: hairline rings and tonal layering first. A blur-radius shadow needs a floating layer and a reason.

**The Scrim Rule.** All on-photo chrome sits on the centralized translucent-black tokens (`lib/ui-tokens.ts`: rest 55%, hover 75%, badge 60%) via `<OverlayPill>`. Hand-rolled `bg-black/NN` pills are banned — that drift is exactly what the component exists to end.

## Shapes

Soft and friendly geometry derived from a single 0.625rem (~10px) base radius: `lg` (10px) for buttons and inputs, `xl` (14px) for cards and dialogs, scaled-down 6–8px for compact controls, and full-round pills/circles for everything drawn over a photograph. Corners are always rounded — nothing in the system is sharp-edged — but never bubbly beyond the 14px card tier. Borders are hairline (1px) and low-contrast; form is conveyed by fill and radius, not by heavy strokes. Photographs themselves stay rectangular and unrounded inside grids and the lightbox except where a card's overflow clip rounds a cover image — the frame may be soft, the frame's subject is not decorated.

## Components

### Buttons
- **Character:** compact, soft-cornered, quietly confident — a 1px downward press on click, no springy scale effects.
- **Shape:** gently rounded (10px radius; compact sizes step down to 6–8px), 32px default height (`h-8`; `sm` 28px, `xs` 24px, plus square icon sizes).
- **Primary:** Instance Accent fill with auto-contrast foreground; hover lightens to 80% opacity; optional `accent-gradient` mode swaps in the derived 135° gradient.
- **Hover / Focus:** color/background transitions only; focus-visible = accent border + 3px ring at 50% opacity. Active state nudges `translate-y-px`.
- **Outline / Secondary / Ghost:** hairline-bordered paper, soft-gray fill, and borderless variants — the workhorses; most admin toolbars are outline/ghost so the single accent action stays loud.
- **Destructive:** Signal Red as tinted fill (10% bg / full-color text, 20% on hover) — dangerous, not screaming.

### Chips (on-photo pills)
- **Style:** `<OverlayPill>` — translucent black over the photo, white text, full-round.
- **State:** `control` variant (interactive: download, like, kebab, pin) darkens on hover and carries a **white** focus ring (the themed ring vanishes on scrims); `badge` variant (counts, video play) is pointer-inert at 60% black.

### Cards / Containers
- **Corner Style:** 14px (`rounded-xl`); first/last child images inherit the rounding.
- **Background:** Paper White (light) / Ink (dark); footer bands use 50% muted.
- **Shadow Strategy:** none — hairline ring per the Hairline Rule.
- **Internal Padding:** 16px via `--card-spacing` (12px for `size="sm"`), consumed by header/content/footer alike.

### Inputs / Fields
- **Style:** 32px, 10px radius, hairline stroke on transparent fill (subtle input-tinted fill in dark mode).
- **Focus:** accent-tracked border plus a 3px halo at 50% ring opacity — the glow *is* the focus language everywhere.
- **Error / Disabled:** `aria-invalid` swaps border and halo to Signal Red tints; disabled drops to 50% opacity with a filled track.

### Navigation
- Sidebar-led admin: flat rows in the sidebar tokens, active state carried by soft-gray fill + accent where appropriate; one shared `DndContext` makes the whole tree a drop target. Below `md` every sidebar becomes an off-canvas drawer (same element, `max-md:` classes). Public galleries navigate by cover cards and sub-gallery pills instead of menus — the photos are the nav.

### Signature: the on-photo chrome family
`<OverlayPill>` + `<MediaBadge>` + the tile scrim form the system's most distinctive pattern: a consistent translucent-black instrument layer that floats over any photograph, in both admin and client grids, sized at the 10–11px grease-pencil scale. It is the visual signature of "marks on a contact sheet" — extend it (new variants/shapes) rather than inventing parallel on-photo chrome.

### Dialogs & Confirmation
All modals are the shadcn `Dialog` (parent-controlled), themed correctly inside both scopes; confirmation prompts are `<ConfirmDialog>` with explicit `destructive`/`pending` states. `window.confirm()` does not exist in this system.

## Do's and Don'ts

### Do:
- **Do** route every recurring icon concept through the `Icons` registry (`lib/ui-icons.ts`) — one concept, one glyph, on every surface.
- **Do** pair `--primary-foreground` with any accent fill; `accentForeground()` already guarantees AA for arbitrary picked hexes.
- **Do** keep muted text at the darkened values (Mid Gray light / Light Gray dark, zinc-600/zinc-400 in gallery scope) — the ~7:1 contrast is a deliberate accessibility choice, not a default to "restore."
- **Do** honor `prefers-reduced-motion`: the global near-instant override must keep covering new animations (0.01ms, not 0s — some libraries need a `transitionend`).
- **Do** build on the existing primitives first — `OverlayPill`, `MediaBadge`, `ConfirmDialog`, `DropdownMenu`, shadcn `Dialog` — before writing any new floating or on-photo chrome.
- **Do** keep every user-facing string translatable (`next-intl`, `en.json` source of truth) — the system ships community-translated.

### Don't:
- **Don't** cross the Two Darkrooms: no `--primary` in public galleries, no gallery branding in admin chrome.
- **Don't** hand-roll `bg-black/NN` on-photo chrome, fixed-position popovers with click-catchers, or `window.confirm()` — the primitives exist precisely because these drifted.
- **Don't** use accent for status: success and destructive keep their own colors; color flags and mode chips keep their own meanings.
- **Don't** cast shadows on resting surfaces or invent z-index rungs — hairline rings, tonal steps, and the fixed ladder.
- **Don't** introduce a new decorative hue, a new display font outside the opener registry, or a second accent emphasis in one view.
- **Don't** decorate the photographs: no filters, tints, rounded crops, or overlays beyond the sanctioned scrim/pill chrome and the deliberate watermark feature.
