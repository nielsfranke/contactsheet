<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Impressum + privacy pages, and the always-on "Powered by" strip

Status: **implemented** (2026-07-09) · Migration: **0047**

> Two features that land in the same place (the bottom of every public gallery) plus one
> **pre-existing AGPL §13 gap** they closed for free.
>
> **Decisions locked at implementation:** privacy policy shipped alongside the Impressum (same
> mechanism, one extra column); the Ko-fi target is **hardcoded** upstream; the strip is **gallery
> only** (`/login` and `/setup` keep generic chrome).
>
> **Verified:** 13 new backend tests, incl. the new-vs-existing default split driven through the
> **real** `alembic upgrade 0046 → 0047` in a subprocess (mutation-checked: flipping the migration's
> `server_default` to `"1"` fails the test). Full backend suite 306 passed; frontend lint + vitest +
> build green; i18n parity clean (en + de).

## The three things

1. **Impressum** — a legally-required imprint (German §5 DDG), reachable in one click from every
   public page.
2. **"Support ContactSheet"** — a subtle upstream link in the gallery footer. **On by default for
   new installations, off for instances that already exist.**
3. **The gap found while scoping these:** `app_settings.source_url` is stored, editable
   (Settings → General) and documented as the AGPL §13 source offer — but it is **rendered nowhere
   public**. It is absent from `GalleryPublicResponse` and appears in no gallery component. AGPL §13
   requires offering source to **network users** (the photographer's clients), not to the admin who
   already has shell access. The strip below is where that link belongs.

## Design

### One always-on strip, independent of `footer_enabled`

The existing branding footer (`footer_enabled` + `footer` JSON, migration 0015, `GalleryFooter.tsx`)
is an **optional photographer branding** element. Neither an Impressum link nor an AGPL source offer
may hang off a toggle the photographer can switch off — an Impressum must be reachable from every
page, and §13 is not conditional.

So: a new, separate `GalleryLegalStrip` renders **below** `GalleryFooter`, on every public gallery,
regardless of `footer_enabled`.

```
[ optional branding footer      ]   ← footer_enabled (unchanged)
─────────────────────────────────
  Impressum · Powered by ContactSheet · Source · Support ♥
```

Composition rules, each part independent:

| Part | Rendered when | Gated by |
|---|---|---|
| `Impressum` link | `impressum` text is non-empty | content presence |
| `Powered by ContactSheet` | always | — |
| `Source` | always | — (AGPL §13) |
| `Support ♥` | opt-out toggle | `support_link_enabled` |

Splitting `Source` (always) from `Support ♥` (toggleable) is the load-bearing detail: it satisfies
§13 unconditionally while leaving the upstream donation plug something an operator can turn off.

### Impressum: hosted page, free text

- New column `app_settings.impressum` (`Text`, nullable). Free text / light Markdown.
- New **public, side-effect-free** endpoint `GET /api/public/impressum` → `{ content }`, **404 when
  empty**. Same posture as `GET /api/public/g/{token}/meta`: no activity log, no notification.
- New Next route `app/impressum/page.tsx` rendering the stored text. When the content is empty the
  page 404s and the footer link is not rendered — an install that hasn't set one shows nothing.
- Edited in **Settings → General**, next to the existing `source_url` field (same legal/instance
  neighbourhood), autosaved on blur via `useSettingsAutosave` like the other text fields.

Free text over structured fields: legal requirements differ per jurisdiction and change over time; a
`{name, street, vat_id, …}` schema is German-specific and churns whenever the law does. One text
column never needs a migration again.

**Markdown rendering:** the app ships no Markdown renderer today. v1 renders **plain text with
preserved line breaks** (`whitespace-pre-line`) — no new dependency, no HTML injection surface.
Emails and URLs are *not* autolinked (that would mean generating markup from the stored body);
Markdown and autolinking are follow-ups if asked for.

> **Security:** the content is admin-authored and rendered as **text, never `dangerouslySetInnerHTML`**.
> This is the same call `branding_icon` / footer fields already make. An admin who wants HTML has
> shell access anyway; injecting a renderer would add stored-XSS surface for zero gain.

### Support link: on for new installs, off for existing ones

This is the only genuinely subtle mechanic, and the codebase already supports it exactly.

`settings_repo.get` creates the singleton **in Python**:

```python
settings = db.get(AppSettings, 1)
if not settings:
    settings = AppSettings(id=1)   # ← Python-side model defaults apply
```

Therefore:

- **Model:** `support_link_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)`
- **Migration 0047:** `add_column(..., server_default="0")`

An **existing** instance already has row `id=1`; `add_column` backfills it with the *server* default
→ **`false`, the button stays off**. A **fresh** install runs migrations against an empty table, then
`settings_repo.get()` INSERTs a new row using the *model* default → **`true`, the button is on**.

No data migration, no `setup_complete` sniffing, no special-casing. The two defaults disagreeing
**is** the feature.

### Public API surface

`GalleryPublicResponse` gains three fields, all instance-global (they ride the already-loaded gallery
response — no extra round-trip, same pattern `footer` / `accent_color` use):

```python
source_url: str            # resolved: settings.source_url or the upstream default
support_link_enabled: bool
impressum_available: bool  # bool, not the text — the page fetches content itself
```

`impressum_available` is a boolean rather than the body so a 40 KB imprint doesn't ride every gallery
payload.

## Data model

Migration **0047** — two columns on `app_settings`:

| Column | Type | Server default | Model default | Meaning |
|---|---|---|---|---|
| `impressum` | `Text`, nullable | `NULL` | `None` | Imprint body; empty ⇒ no link, route 404s |
| `support_link_enabled` | `Boolean`, not null | `"0"` | `True` | ← the new/existing split |

## Files (estimate)

| File | Change |
|---|---|
| `backend/alembic/versions/0047_impressum_and_support_link.py` | **new** — two columns |
| `backend/app/models/app_settings.py` | the two columns (note the default asymmetry) |
| `backend/app/schemas/settings.py` | `impressum`, `support_link_enabled` on update/response |
| `backend/app/schemas/gallery.py` | 3 fields on `GalleryPublicResponse` |
| `backend/app/services/gallery_service.py` | populate them in `get_public_gallery` |
| `backend/app/routers/public.py` | `GET /api/public/impressum` (404 when empty, no side effects) |
| `backend/app/routers/admin_settings.py` | the two scalars in the PATCH loop |
| `frontend/src/components/gallery/GalleryLegalStrip.tsx` | **new** — the always-on strip |
| `frontend/src/components/gallery/GalleryView.tsx` | render the strip below `GalleryFooter` |
| `frontend/src/app/impressum/page.tsx` | **new** — public imprint route |
| `frontend/src/app/admin/settings/general/page.tsx` | Impressum textarea + Support toggle |
| `frontend/src/lib/{types,api}.ts` | types + `api.public.impressum()` |
| `frontend/messages/en.json` | `gallery.legal.*` (+ `validate-i18n.mjs`) |
| `backend/tests/` | see below |

## Tests

- **The split** (the important one): fresh DB → migrate → `settings_repo.get()` ⇒
  `support_link_enabled is True`. Pre-existing row → `alembic upgrade` ⇒ `False`.
- `GET /api/public/impressum` → 404 when unset, 200 + body when set; asserts **no activity row and
  no notification** is written (side-effect-free, mirroring the `/meta` test).
- `GalleryPublicResponse` carries `source_url` even when the footer is disabled (the §13 fix).
- Impressum body is escaped, not interpreted, when it contains `<script>`.

## Invariants

- The strip renders on **every** public gallery. `footer_enabled=false` hides the branding footer
  and nothing else.
- **`Source` is never hidden.** Only `Support ♥` is toggleable. AGPL §13 is not an opt-out.
- Existing instances are visually unchanged **except** for the newly-appearing legal strip (which is
  the point — it closes the §13 gap) — the support link stays off until an admin opts in.
- The imprint is rendered as text. No HTML, no Markdown, no `dangerouslySetInnerHTML`.

## Decisions (resolved 2026-07-09)

1. **Datenschutz / privacy policy** → **shipped in the same migration.** Same mechanism as the
   Impressum (one `Text` column, one route, one link); a second migration later would be pure churn.
   Route is `/privacy`; the label is i18n'd ("Datenschutz" in de).
2. **Support target** → **hardcoded upstream** (`https://ko-fi.com/nielsfranke`, in
   `GalleryLegalStrip.tsx`). A fork wanting its own donation link is editing source anyway, and
   `source_url` already covers fork attribution.
3. **Strip on admin surfaces** → initially gallery-only; **`/login` and `/setup` added 2026-07-09.**
   They are public pages, so the same reasoning applies: an Imprint must be reachable from every one
   of them, and the §13 source offer is made to anyone who can reach the app. They read the
   already-public `GET /api/setup/status` (which the login screen fetches anyway for branding),
   extended with the same four flags — no new endpoint, no auth. Rendered via `AuthLegalStrip`,
   which passes `themed` so the strip uses admin theme tokens instead of the gallery's zinc scheme.
   `/admin` itself stays clean (it is behind auth, not a public page).

## Follow-ups (out of scope)

- Markdown rendering for the legal bodies (v1 is plain text + `whitespace-pre-line`; adding a
  renderer would introduce stored-XSS surface for an admin-authored field).
- A `Textarea` primitive — the two fields reuse `Input`'s classes via `LEGAL_TEXTAREA_CLS`; worth
  extracting if a third long-text setting appears.

## Deployment impact

Plain image pull + `alembic upgrade head` (0047, two `app_settings` columns; runs automatically in
`start.sh`). No nginx change, no compose change, no new dependency.
