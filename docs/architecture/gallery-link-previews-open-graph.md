# Gallery link previews — Open Graph & per-gallery title

Status: **implemented** (2026-06-22). Triggered by photographer feedback: pasting a gallery share
link into WhatsApp shows only the instance **logo**; iMessage happens to surface a gallery image,
but inconsistently. Root cause: the gallery route emitted **no per-gallery metadata at all**.

**Shipped:** `GET /api/public/g/{share_token}/meta` (`GalleryMetaResponse`, side-effect-free) +
a server `app/g/[share_token]/layout.tsx` with `generateMetadata`. `BACKEND_INTERNAL_URL` added to
the frontend service in `docker-compose.yml`. **Verified:** backend suite green incl. 5 new tests
(name+image, password hides cover, expired→404, unknown→404, and a side-effect-free assertion that
`/meta` queues no `view` notification while the full endpoint does); frontend lint + `tsc` clean.
Remaining: a real unfurl check (paste link into WhatsApp/iMessage) on a deployed instance.

## The problem

`frontend/src/app/g/[share_token]/page.tsx` is a fully **`"use client"`** component with **no
`generateMetadata`**. The only server-rendered `<head>` metadata for a gallery URL is the root
layout (`app/layout.tsx`): a fixed `title: "ContactSheet"` and the branding `icons`. So:

- **There is no `og:image`, no `og:title`, no `og:description`.**
- WhatsApp / Signal / Facebook scrapers don't execute JS and read only OG/`<meta>` tags. With no
  `og:image` they fall back to the `icon` / `apple-touch-icon` link → the **branding logo**. Exactly
  the reported behaviour.
- iMessage's scraper is looser (and caches differently), so it sometimes surfaces *an* image — but
  it's not a controlled, consistent preview.
- The link title is the static **"ContactSheet"** for every gallery, instead of the gallery's name.

## Goal

When a gallery share link is unfurled by any platform, show a **controlled preview**:

- **Title** = the gallery's name (e.g. *"Hochzeit Anna & Tom"*), not "ContactSheet".
- **Image** = the gallery's cover / header image (the same image the link opener sees on the
  landing), not the logo.
- **Description** = the gallery description (when set).
- Consistent across WhatsApp, iMessage, Signal, Telegram, Slack, Discord, Facebook, Twitter/X.

Non-goal: change anything about the interactive gallery view itself — only the server-emitted
`<head>` for the route.

## Design

### 1. A server `layout.tsx` for the gallery route — the only structural change

Next App Router requires `generateMetadata` in a **server** component. The page must stay a client
component (it reads `sessionStorage` tokens, runs React Query, etc.). The clean split:

```
app/g/[share_token]/
  layout.tsx   ← NEW: server component, exports generateMetadata; renders {children}
  page.tsx     ← unchanged: "use client" gallery view
```

A server layout can wrap a client page; `generateMetadata` runs server-side per request and emits
the `<head>` tags. The page's runtime behaviour is untouched.

> Implementation note: this Next version differs from training data (see `frontend/AGENTS.md`).
> Before writing the layout, check the bundled docs for the current `generateMetadata` /
> `params` contract — `params` is async (`await params`) in this version.

`generateMetadata`:

1. `await params` → `share_token`.
2. Fetch gallery preview metadata server-side (endpoint below).
3. Return Next `Metadata`:

```ts
{
  title: meta.name,                        // overrides the root "ContactSheet" for /g/* only
  description: meta.description || undefined,
  openGraph: {
    type: "website",
    title: meta.name,
    description: meta.description || undefined,
    siteName: meta.instance_name || "ContactSheet",
    images: meta.image_url ? [{ url: meta.image_url }] : undefined,
  },
  twitter: {
    card: meta.image_url ? "summary_large_image" : "summary",
    title: meta.name,
    description: meta.description || undefined,
    images: meta.image_url ? [meta.image_url] : undefined,
  },
}
```

On any failure (fetch error, gallery not found) return **no override** → falls back to the root
layout's "ContactSheet" + logo, i.e. exactly today's behaviour. **The preview must never break the
page.**

### 2. A dedicated, side-effect-free meta endpoint

Do **not** reuse `GET /api/public/g/{share_token}` for this — it (a) over-fetches the full gallery
incl. every image, and critically (b) **enqueues a `view` notification and logs a view activity**
(`public.py:76-78`). A link-unfurl by WhatsApp's servers must **not** fire a "Gallery opened" push
or pollute activity. So:

**`GET /api/public/g/{share_token}/meta` → `GalleryMetaResponse`** (new, no auth, no side effects):

```json
{
  "name": "Hochzeit Anna & Tom",
  "description": "",
  "image_url": "https://gallery.example.com/uploads/…/medium.jpg",  // or null
  "instance_name": "Studio Müller",
  "password_protected": false
}
```

Rules:

- **Password-protected** gallery → return `name` + `password_protected: true`, but **`image_url:
  null`**. The cover sits behind the password gate; don't leak it to scrapers. (The name is not
  secret — anyone with the link sees "Enter password for <name>".)
- **Expired / soft-deleted / unknown** token → `404`. Frontend falls back to the generic preview.
- `image_url` source order: `header_image_url` → `cover_image_url` → first approved image's
  `medium` rendition → `null`. Reuse the **public serializer's** URLs so watermark / proxy-variant
  rules already applied to the landing cover carry over unchanged. **Never** the original.
- **No `notification_service.enqueue`, no `activity_service.log_*`.** This endpoint is read-only.

### 3. Absolute image URLs

`og:image` **must be absolute** — scrapers don't resolve relative paths. Two layers, belt-and-braces:

- **Backend** builds `image_url` absolute from `app_settings.public_base_url` (migration 0008,
  already the canonical external origin used for share links) when it's set.
- **Frontend** sets Next `metadataBase` from the incoming request host (`headers()` in the server
  layout) as a fallback, so relative URLs still resolve to absolute even if `public_base_url` is
  blank. `public_base_url`, when set, wins.

No new column, no migration — `public_base_url` already exists.

### 4. Server → backend connectivity (deploy)

Today the Next **server** never calls the backend: the browser hits nginx (`/api/*` → backend), and
the dev server proxies via `next.config.ts` rewrites. `generateMetadata` introduces a **new
server-side** backend call. Needs an internal URL:

- New server-only env var on the frontend container, e.g. `BACKEND_INTERNAL_URL`, default
  `http://backend:8000` in compose (service name), `http://localhost:8000` in dev (mirror the
  existing `NEXT_PUBLIC_API_BASE` fallback).
- Document in `docker-compose.yml` (frontend service) and the deploy docs. nginx is **not** on this
  path — it's container-to-container.

### 5. Caching

Scrapers re-fetch on each share; covers change rarely. Use a short `revalidate` (e.g. 60s) on the
meta fetch so a cover change propagates without a per-unfurl backend round-trip storm. `no-store` is
the safe fallback if revalidate proves fiddly with this Next version.

## Security / privacy

- The preview reveals **name + cover** only to holders of the share link — the same capability as
  opening the link. No new exposure, **except** that link-unfurler servers (WhatsApp/Apple/Meta)
  will fetch the cover; that's the intended trade-off of a rich preview and is standard.
- **Password-protected galleries withhold the cover image** (name only). This is the one explicit
  privacy decision — encoded server-side in the meta endpoint, not the client.
- Endpoint is **read-only and side-effect-free** — no view push, no activity log, so scraper hits
  can't be mistaken for client views or spam notifications.

## Testing

- Backend (pytest): `/meta` returns name+image for a normal gallery; **null image** for a
  password-protected one; `404` for expired/unknown; and asserts it enqueues **no** notification and
  logs **no** activity (the side-effect-free guarantee).
- Frontend: `generateMetadata` returns gallery title + og:image for a stub meta response, and falls
  back cleanly (no throw, "ContactSheet") when the fetch fails.
- Manual: paste a gallery link into WhatsApp + iMessage; confirm gallery name + cover. Validate raw
  tags with the [Facebook Sharing Debugger] / `curl -A facebookexternalhit <url>`.

## Out of scope

- Per-image preview (deep-linking a single photo with its own og:image).
- Single-image-download notifications (explicitly declined — separate gap noted in chat).
- OG previews for the admin app (`/admin`, `/login`) — those should stay generic/branding-only.
