# Internationalization & community localization

Status: **implemented** — 2026-06-14 (proposed & shipped same day)

> All three phases are live. The app ships English + German (`frontend/messages/{en,de}.json`,
> 576 ICU keys/locale) via `next-intl` in no-routing mode; the backend carries a `code` on
> client-visible errors (`CodedHTTPException`). Community translation runs on **Weblate**
> (`https://translate.nielsbox.cc`) wired to the Forgejo repo — push → webhook → auto-pull, with
> translations flowing back through a `weblate` branch + PR. See `TRANSLATING.md` (contributor flow)
> and `deploy/weblate/` (the deployment). Catalog validator: `frontend/scripts/validate-i18n.mjs`.

## Goal

Make ContactSheet translatable, and let the community contribute translations without touching code.
Two audiences with different needs:

- **Admin** (the photographer, one per instance) — picks their language; it's a stored preference.
- **Public gallery** (their clients) — never picks; we **auto-detect** from the browser.

English is the single source of truth. Translators only ever edit `messages/<locale>.json`.

## Why not Next's native `[lang]` routing

This repo is **Next 16** (`AGENTS.md`: "not the Next.js you know"). The vendored guide
(`node_modules/next/dist/docs/01-app/02-guides/internationalization.md`) describes the built-in
pattern: nest the whole `app/` tree under `app/[lang]/` and prefix every URL (`/de/admin`,
`/de/g/{token}`). That's a poor fit here:

- It would **restructure every route** under `[lang]` (`admin/`, `g/[share_token]/`, `setup`,
  `login`, …) and rewrite every internal `<Link>`.
- It puts a locale segment in **share links** (`/de/g/{token}`) — those are handed to clients and
  must stay stable; we don't want `/g/{token}` and `/de/g/{token}` to diverge.
- Locale here is a **preference/negotiation**, not a routing concern.

**Decision:** use **`next-intl` in "without i18n routing" mode** — locale comes from a cookie +
`Accept-Language`, the URL never changes, and the `app/` tree is untouched. `next-intl` is the
first library Next's own guide recommends and is purpose-built for the App Router (Server + Client
Components, ICU MessageFormat, type-safe keys).

> **Compatibility — verified 2026-06-14.** Installed: Next **16.2.9**, React **19.2.4**.
> `next-intl@4.13.0` declares peer deps `next: "… || ^16.0.0"` and `react: "… || ^19.0.0"` — both
> satisfied — and its v4 package exports `./plugin`, `./server`, `./routing`, `./navigation` (the
> `createNextIntlPlugin` / `getRequestConfig` / `getTranslations` entry points this doc uses).
> **Pin `next-intl@^4.13.0`.** Remaining check is a runtime smoke test (provider + one
> `useTranslations` call) during Phase 1 — standard for any integration.

## Architecture

### Locale resolution (one locale per request)

A single `src/i18n/request.ts` (`getRequestConfig` from `next-intl/server`) resolves the active
locale, in order:

1. **`NEXT_LOCALE` cookie**, if set and supported — the admin's chosen language (set by the
   settings picker) or a returning visitor's negotiated choice.
2. **`Accept-Language` negotiation** against `SUPPORTED_LOCALES` — covers first-time public
   visitors. Use `@formatjs/intl-localematcher` + `negotiator` (the exact pair Next's guide shows).
3. Fallback **`en`**.

This unifies both audiences: the admin picker writes the cookie; public clients are auto-detected.
No `[lang]` segment, so `/g/{token}` is unchanged.

`Proxy` (Next 16's renamed middleware, `src/proxy.ts`) is **optional** and kept minimal — only if
we want to persist the negotiated public locale back into the `NEXT_LOCALE` cookie on first hit so
later requests skip negotiation. Header reading already happens in `request.ts`, so we can ship v1
without a Proxy and add it only if profiling says so.

### Wiring

- `src/i18n/request.ts` — `getRequestConfig` → `{ locale, messages }`, loading
  `messages/<locale>.json` (dynamic `import`, server-only — translation files never hit the client
  bundle except what the client provider needs).
- `next.config.ts` — wrap with `createNextIntlPlugin('./src/i18n/request.ts')`.
- `app/layout.tsx` (already a Server Component) — read the resolved locale, set `<html lang=…>`,
  and wrap children in `NextIntlClientProvider` with the active messages. This sits alongside the
  existing pre-hydration theme script + font-variable classes; no conflict.
- **Usage:**
  - Server Components → `getTranslations()` / `getLocale()` from `next-intl/server`.
  - Client Components (most of this app — `"use client"` admin pages, gallery, Zustand/react-query)
    → `useTranslations()` / `useLocale()` hooks, provided by `NextIntlClientProvider`.

### Message catalogs

- `frontend/messages/en.json` is the **source**; `de.json`, `fr.json`, … are translated copies.
- **Nested keys by surface**, mirroring the app's structure so translators get context:
  `admin.galleries.create`, `gallery.lightbox.next`, `settings.appearance.title`, `common.cancel`.
- **ICU MessageFormat** — replaces the app's hand-rolled English plurals/concatenation. Today the
  code does `` `${n} photo${n === 1 ? "" : "s"}` `` in many places (overview cards, ZIP, uploads);
  these become:
  ```json
  { "gallery.photoCount": "{count, plural, =0 {No photos} one {# photo} other {# photos}}" }
  ```
  ICU gets plurals right for languages English can't express (Polish, Russian, Arabic, …).
- Dates/numbers via `next-intl`'s `useFormatter` (locale-aware), retiring ad-hoc formatting.

### Admin language preference (persisted)

Mirror the existing `admin_theme` pattern exactly:

- **Migration** — add `admin_locale` (`String`, default `"en"`) to `app_settings` (next number is
  **0024**).
- Surfaced through the existing `GET`/`PATCH /api/admin/settings` (`admin_settings.py` /
  `schemas.settings`), like `admin_theme`/`accent_color`.
- **UI** — a language `<select>` in `/admin/settings/appearance` (next to Theme). On change: PATCH
  the setting **and** set the `NEXT_LOCALE` cookie so SSR picks it up immediately (same dual-write
  spirit as the theme's localStorage cache).
- The DB value is the durable per-instance default; the cookie is the per-request fast path.

### Backend strings — do **not** translate the backend (v1)

There are **87 `HTTPException(detail=…)`** strings, but most are dev/admin-facing ("Gallery not
found", validation messages). Standing up a second i18n toolchain (Babel/gettext) for them isn't
worth it.

- Keep backend details in **English**.
- For the **handful clients actually see** (wrong gallery password, gallery expired/410, upload too
  large/415/413, client-upload disabled/403), add a stable machine-readable **`code`** to those
  error responses; the frontend maps `code → localized message`. This keeps all client-visible
  i18n in one place (the frontend catalogs) and is a small, surgical backend change.
- Revisit a full backend i18n only if a real need appears (e.g. localized emails) — out of scope.

## Community contribution: Weblate on Forgejo

You already self-host **Forgejo**, so keep the toolchain self-hosted and FOSS-aligned.

- **Weblate** (open-source, self-hostable; the de-facto FOSS standard) points at the ContactSheet
  Forgejo repo, watching `frontend/messages/*.json`. Translators use Weblate's web UI (string list,
  suggestions, review, glossary, screenshots-for-context); Weblate commits/pushes back to a
  translation branch and opens a PR.
- **Component config** — file format `JSON nested structure`, source `messages/en.json`, file mask
  `messages/*.json`, new-language template = `en.json`. Enable "add new languages" so contributors
  can start a locale themselves.
- **Quality gates** — Weblate checks (placeholder/ICU consistency, missing interpolations) catch
  broken translations before they merge; English stays read-only there (edited only in code).
- **Alternative if you'd rather not run Weblate:** Crowdin or Tolgee (free OSS tiers, hosted). Same
  catalog format, so this choice is reversible and doesn't affect the app code.

A short `TRANSLATING.md` documents the flow: "don't edit code — use Weblate; English changes happen
in PRs."

## Phasing

- **Phase 1 — Foundations + one surface.** Add `next-intl` (verified on Next 16), `request.ts`,
  provider in `layout.tsx`, `messages/en.json`, and migrate the **public gallery** end-to-end
  (highest client value; auto-detect already covers it). Add `admin_locale` (migration 0024) +
  appearance picker. Ship **German** as the first non-English locale to prove the pipeline.
- **Phase 2 — Admin surface.** Migrate `app/admin/**` and shared components incrementally
  (settings, gallery detail/overview, dialogs, toasts). Add the small backend error-`code` contract
  for client-visible errors.
- **Phase 3 — Open the doors.** Stand up Weblate against Forgejo, write `TRANSLATING.md`, announce.
  New languages land as PRs from there.

## Risks / open items

- **`next-intl` × Next 16** — ✅ verified compatible (peer deps + exports, see note above); pin
  `^4.13.0`. Fallback if a runtime issue surfaces: Next's native `getDictionary` pattern *in
  without-routing form* (read locale in `layout.tsx`, pass dict via a small context) — more manual,
  no `[lang]` needed either.
- **Extraction is the real cost** — ~77 files of inline English + manual plurals. It's mechanical
  but large; do it per-surface (Phase 1/2) rather than big-bang. A lint rule
  (`eslint-plugin-formatjs` or a custom "no literal JSX text" check) can prevent regressions once a
  surface is migrated.
- **FOUC / hydration** — locale is resolved server-side and `<html lang>` set in the root layout, so
  no flash; keep it consistent with the existing pre-hydration theme script.
- **Pluralization correctness** — moving to ICU is the point; budget review time for languages with
  complex plural rules.

## Touched files (Phase 1)

- `frontend/package.json` (`next-intl`, `@formatjs/intl-localematcher`, `negotiator`)
- `frontend/next.config.ts` (`createNextIntlPlugin`)
- `frontend/src/i18n/request.ts` (new)
- `frontend/src/proxy.ts` (optional)
- `frontend/src/app/layout.tsx` (`NextIntlClientProvider`, `<html lang>`)
- `frontend/messages/en.json`, `frontend/messages/de.json` (new)
- `frontend/src/components/gallery/**`, `frontend/src/app/g/[share_token]/**` (migrate strings)
- `backend/alembic/versions/0024_admin_locale.py` (new) + `app_settings` model / `schemas.settings`
- `frontend/src/app/admin/settings/appearance/page.tsx` (language picker)
- `TRANSLATING.md` (Phase 3)
