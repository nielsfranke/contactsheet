# Accent color system & toast theming

Status: **implemented** (2026-06-16). Migration: **0032** (one boolean column, Part 2 only).

Three related requests, one topic — how the instance **accent color** propagates through the admin
surface, and the one place theming is currently broken (toasts):

1. A **gradient** option for accent-driven surfaces (e.g. primary buttons).
2. Written **rules** for where accent may/may not be used (a `docs/design-system.md` section).
3. **Toasts** following the real dark/light mode (and optionally the accent).

## Current state

- **Accent wiring is narrow.** `lib/theme.ts::applyAdminTheme(theme, accent)` sets only three CSS
  vars on `<html>`: `--primary`, `--ring`, `--primary-foreground` (the last via `accentForeground()`,
  a WCAG-luminance auto-contrast picker). The inline pre-hydration script in `app/layout.tsx` mirrors
  the same three from `localStorage` to avoid FOUC. `AdminThemeProvider` re-applies from
  `app_settings.accent_color` on every admin route.
- **Accent is admin-only.** Public galleries deliberately use a *separate* identity system —
  `brand_color` (masthead) and `accent_color` (footer icon circles only). This doc does **not** touch
  the public gallery; "accent" here = the admin-surface `--primary`.
- **No accent rule exists.** `docs/design-system.md` codifies icons, overlay pills, badges, dialogs,
  dropdowns — but says nothing about accent/`--primary`, so usage is ad-hoc.
- **Toasts are mis-themed.** `components/ui/sonner.tsx` resolves its theme from
  `useTheme()` (**next-themes**) — but next-themes is **never mounted**; the app toggles the `dark`
  class on `<html>` directly via `AdminThemeProvider`. So the Toaster always sees `theme="system"`
  and follows the **OS** scheme, not the instance theme. (The toast bg/text already use `--popover`/
  `--border` tokens, which *do* flip with the class, so the break is partial — `richColors` tints and
  sonner's own `data-theme` are what diverge.)

## Goals / non-goals

**Goals**

- Codify accent usage so it stays consistent as surfaces are added (Part 1).
- Offer an opt-in gradient for primary CTAs without asking the user to pick a second color (Part 2).
- Make toasts follow the actual instance theme; optionally accent the toast action (Part 3).

**Non-goals**

- No change to the **public gallery** identity system (`brand_color` / footer `accent_color`).
- No second color picker — the gradient is **derived** from the single accent (see Part 2).
- No gradients on dense/small buttons or on text — see the rules in Part 1.
- No next-themes adoption — we keep the existing class-on-`<html>` model and read from it.

---

## Part 1 — Accent usage rules (design-system doc)

Add a **"Accent color (`--primary`)"** section to `docs/design-system.md`. Proposed rules:

- **Use accent for:** the primary action in a group (`Button` default variant), focus rings
  (`--ring`), the active state of nav/tabs, and key inline links. One emphasis per view — if two
  things are accent, neither reads as primary.
- **Do not use accent for:** large background fills or page chrome, body/label text, success or
  **destructive** actions (those keep `--destructive` / status colors), or to recolor icons that
  carry their own meaning (color flags, mode chips).
- **Always pair with `--primary-foreground`** for text/icons on an accent fill — never assume white.
  `accentForeground()` already guarantees contrast for any picked hex.
- **Accent is theme-independent** — the same hex rides both light and dark admin themes, so it must
  read on both. The picker should keep a mid-range luminance (a future nicety, not in scope).

No code, no migration — documentation only. Ships first and independently.

## Part 2 — Gradient accent option

A per-instance toggle that renders accent-filled CTAs as a **subtle gradient** instead of a flat fill.

### Derivation — no second color, no JS

Compute both stops from the single accent in CSS via `color-mix`, so nothing new is stored or
calculated in JS and it updates live with the picker:

```css
/* defined once in :root (globals.css), alongside --primary */
--primary-gradient: linear-gradient(
  135deg,
  color-mix(in oklab, var(--primary), white 28%),
  color-mix(in oklab, var(--primary), black 18%)
);
```

`oklab` mixing keeps the hue stable while shifting lightness, so the gradient stays on-brand for any
accent (unlike sRGB mixing, which muddies saturated hues). `color-mix` is supported in all current
evergreen browsers (the app already targets them). **The lightness span is deliberately wide
(`white 28%` / `black 18%`)** — an early `10%/12%` was imperceptible for *achromatic* accents (a
black or white accent has no hue to shift, so it relies entirely on the lightness delta).

### Where it applies

- **Primary `Button` variant only** (`components/ui/button.tsx`) and, if desired later, the masthead
  brand chip. Gated so it's `background-image: var(--primary-gradient)` when enabled, flat `--primary`
  otherwise. Hover/active keep the existing token behavior (slightly darkened) layered over.
- **Explicitly not**: `outline`/`ghost`/`secondary`/`destructive` buttons, focus rings, small/dense
  buttons, badges. (Same spirit as Part 1's "one emphasis" rule — gradients are for hero CTAs.)

### Storage

- `app_settings.accent_gradient` (boolean, default **false** = current flat look). **Migration 0032.**
- Rides the existing `GET`/`PATCH /api/admin/settings` (`AppSettingsUpdate.accent_gradient`).
- Applied by `applyAdminTheme()`: when on, set `--primary-gradient` (above) and add a marker class
  (e.g. `html.accent-gradient`) that the primary button variant keys off; the pre-hydration script
  mirrors the flag from `localStorage` like the other accent vars (one more cached key).
- UI: a switch in **Settings → Branding**, directly under the accent picker, with a live preview
  button (the page already does live accent preview + restore-on-leave).

## Part 3 — Toast theming

### Fix the dark/light break (the concrete bug)

Stop reading next-themes. Drive the Toaster from the **document's actual theme** — a tiny hook that
reads `documentElement.classList.contains("dark")` and updates on a `MutationObserver` (class attr):

```ts
// useDocumentTheme(): "light" | "dark" — single source = the <html> class the app already toggles
```

`sonner.tsx` passes `theme={useDocumentTheme()}`. This is correct on **both** surfaces with no
provider: public `/g/*` is always-dark (script removes `dark` only for admin/login/setup), admin
follows `app_settings.admin_theme`. The existing `--popover`/`--border` token overrides stay.

### Optional accent tint

Tint the toast action button with `--primary` so an action (e.g. Undo) picks up the instance accent.
Sonner has no `--toast-*` var for this, so it's done via the documented `actionButtonStyle` prop:

```ts
toastOptions={{ actionButtonStyle: { background: "var(--primary)", color: "var(--primary-foreground)" } }}
```

Keep `richColors` for success/warning/error semantics (status colors, **not** accent — consistent
with Part 1: accent ≠ status).

No migration for Part 3.

## Migration

```
0032 — accent_gradient on app_settings (boolean, default false)
```

Only Part 2 needs it. Parts 1 and 3 are frontend/doc-only.

## Rollout (each step ships independently)

1. **Part 1** — design-system.md accent section. No code.
2. **Part 3 fix** — `useDocumentTheme` + `sonner.tsx`. Pure bug fix; no setting.
3. **Part 2** — migration 0032, `accent_gradient` through settings, `applyAdminTheme` + button
   variant + Branding toggle + pre-hydration mirror.
4. **Part 3 tint** (optional polish) — accent the toast action var.

## i18n

New strings: Branding **gradient** toggle label + hint (`settings.*`). Run
`cd frontend && node scripts/validate-i18n.mjs` after editing `en.json`/`de.json`.

## Follow-ups (out of scope)

- Accent in the **public** gallery (would unify `brand_color`/`accent_color` — separate decision).
- Luminance guard in the accent picker (reject too-light/too-dark hexes that fail on one theme).
- Per-gradient direction/intensity controls (deliberately omitted — one tasteful default).

## Files (as shipped)

| File | Change |
|---|---|
| `docs/design-system.md` | + Accent color rules 7–10 (Part 1) |
| `frontend/src/components/ui/sonner.tsx` | read document theme; accent the action button (Part 3) |
| `frontend/src/hooks/useDocumentTheme.ts` | **new** — class-based theme reader (Part 3) |
| `backend/alembic/versions/0032_accent_gradient.py` | **new** — `accent_gradient` column (Part 2) |
| `backend/app/models/app_settings.py`, `schemas/settings.py`, `routers/admin_settings.py` | `accent_gradient` field (Part 2) |
| `frontend/src/app/globals.css` | `--primary-gradient` derived from `--primary` (Part 2) |
| `frontend/src/lib/theme.ts` | toggle `.accent-gradient` + cache the flag when enabled (Part 2) |
| `frontend/src/app/layout.tsx` | mirror the gradient flag in the pre-hydration script (Part 2) |
| `frontend/src/components/ui/button.tsx` | primary variant uses the gradient under `.accent-gradient` (Part 2) |
| `frontend/src/components/admin/AdminThemeProvider.tsx`, `settings/{branding,workspace}/page.tsx` | thread the gradient flag; Branding toggle + live preview (Part 2) |
| `backend/app/routers/setup.py`, `frontend/src/app/{login,setup}/page.tsx`, `lib/api.ts` | expose `accent_gradient` pre-auth so login/setup don't strip the class (Part 2) |
| `frontend/src/lib/types.ts`, `frontend/messages/{en,de}.json` | `accent_gradient` types + toggle strings (Part 2) |
