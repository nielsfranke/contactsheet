# Header/Cover uploads & bounded Open Graph image

Status: **proposed** (2026-06-24). Triggered by photographer feedback: a client's share link
(`picshare.matthias-aletsee.com`) shows **no WhatsApp preview**, while Telegram, Apple Mail and
Instagram unfurl it fine — and the photographer's own links work everywhere. "Broke since the last
update."

## What we found (diagnosis)

Live comparison of the two instances' `og:image` files:

| | working link (Niels) | broken link (Matthias) |
|---|---|---|
| og:image bytes | **463 KB** | **4.0 MB** |
| format | JFIF, **progressive** | Exif standard, **baseline** |
| EXIF | none | full camera EXIF (SONY ILCE-7RM5) |
| dimensions | 2560×1709 | 2500×1667 |

Three independent facts pin the root cause:

1. **WhatsApp is the only unfurler with a hard, small image-size cap** (~600 KB–1 MB). Telegram
   (~5 MB), Apple Mail and Instagram's `facebookexternalhit` all tolerate multi-MB images. A 4 MB
   `og:image` → WhatsApp silently drops the card; everyone else shows it. This is exactly the
   reported pattern. **CSP is not involved** — crawlers ignore CSP, and the OG tags are served
   correctly to a WhatsApp user-agent (verified).
2. **The two headers came through different code paths.** The EXIF + "baseline" marker proves
   Matthias's file never went through Pillow (`_save_resized` strips EXIF and writes
   `progressive=True`). It is a **raw original**. Niels's file is a Pillow **`medium` rendition**.
3. **`use_image_as_header` falls back to copying the full original** when a `medium` rendition is
   absent (`image_service.py:510-511`). That is how a 4 MB original became the header — and the
   `og:image`.

The "19 MB still works for me" test is consistent, not contradictory: that 19 MB source was reduced
to a 463 KB `medium` before being served. **What matters is the served `og:image` bytes**, not the
upload.

### Two further bugs surfaced while diagnosing

- **Header/cover uploads are capped at 1 MB by nginx.** `nginx.conf:7` sets
  `client_max_body_size 1m` as the server default; only the photo-upload location
  (`~ ^/api/(galleries|public/g)/[^/]+/images$`) raises it to `2g`. The header-image, cover-image,
  branding-logo and watermark endpoints fall through to `location /api/` and inherit **1 MB** →
  anything larger gets a **413 from nginx** before the backend (which allows 10 MB) ever runs.
  Latent **since v1.0.0**, not introduced by the recent update. This is the "I can't upload a header
  over 1 MB" report.
- **Header/cover uploads are never resized server-side.** `upload_header_image`
  (`galleries.py:279`) and `upload_cover_image` (`galleries.py:350`) write the uploaded bytes
  verbatim (`f.write(data)`). A multi-MB header also slows the normal admin/gallery page load, not
  just link previews.

### Not a bug (answering the second question)

The **Set Header / Set Cover** buttons disappearing from the top once a gallery has photos is
**intentional** (`page.tsx:311-313`, explicit comment): for a non-empty gallery those actions move
to the sidebar kebab (⋮); the top buttons exist only for an empty gallery as the sole CTA. Out of
scope for this change — flagged separately if the discoverability should be revisited.

## Goal

1. A pasted share link **always unfurls on WhatsApp**, regardless of how the header/cover was set or
   how large the source was — **including existing oversized headers** (Matthias) with no admin
   action required.
2. Header/cover uploads **accept files larger than 1 MB**.
3. Header/cover files are **stored at a sane size**, so they don't bloat page loads.

## Design

The display header and the link-preview image have **different size needs**, so they get different
treatment:

- The **displayed header** is a single **non-`srcset`** `<img src>` (admin `page.tsx:226`, public
  `GalleryPresentationLayout.tsx:92` / `GalleryCollabLayout.tsx:72`) — one file for every screen,
  shown full-width up to `clamp(160px, 25vw, 320px)` tall. Today it is served **unresized** (full
  original), so capping it small would visibly soften 4K/Retina displays. It wants to stay sharp at
  large widths, so the stored header **cannot double as the og:image**.
- The **og:image** wants to be small and universally accepted (≤ ~1200 px, < ~300 KB).

Because the og:image is a **separate** variant (mechanism 3), header display quality and WhatsApp
compatibility are **decoupled** — the stored header can stay large for sharpness while WhatsApp gets
its own small image. Hence two mechanisms.

### 1. nginx — lift the 1 MB cap on admin image uploads

Extend the existing `2g` location regex (or add a sibling location) to cover the header, cover,
branding-logo and watermark upload endpoints, so they no longer inherit the 1 MB server default. The
backend keeps the real ceiling (`read_limited`, 10 MB) and per-endpoint validation; nginx is just a
gate. (No 2g here — these aren't photo originals; a few-MB ceiling is plenty.)

### 2. Resize header & cover on store

Introduce a small shared in-memory helper (factored from `_save_resized`) that takes the uploaded
bytes and returns a bounded JPEG (**long edge ≤ 3840 px, q82**, EXIF stripped, progressive). 3840
keeps a full-width header sharp on 4K and covers Retina laptops; at q82 that's ~1–2 MB, a fraction
of an unbounded original (only 5K full-width is marginally soft — acceptable for a single decorative
banner, and not worth adding `srcset` for). Apply it in `upload_header_image`, `upload_cover_image`,
and the `use_image_as_header` fallback (so a missing `medium` no longer means "copy the full
original"). Result: stored headers/covers are bounded going forward, and the from-image path can
never emit a multi-MB file again.

### 3. Bounded og:image variant (covers existing files retroactively)

Add a dedicated, side-effect-free **og-image endpoint** that derives a small variant
(long edge ≤ 1200, q80 JPEG, target < ~300 KB) from whatever `_meta_image_url` already selects
(header → uploaded cover → first photo's `medium`), served on the fly with an **ETag** keyed on the
source file signature — the same idiom as `app/services/branding_icon.py` (rendered, ETag-cached,
served under `/api/`). `GalleryMetaResponse.image_url` (and thus `layout.tsx`'s `og:image`) points
at this endpoint instead of the raw header file.

Why on-the-fly rather than a stored `og.jpg`: it **covers existing oversized headers** (Matthias)
with **no migration/backfill** and no admin action, and it stays correct automatically when the
header/cover/cover-photo changes. Cost is one small resize per cold cache entry; the ETag makes
repeat scrapes a 304.

Password-protected galleries keep today's behaviour (name yes, cover no) — the endpoint 404s/204s
for them, matching `get_gallery_meta`.

## Deployment / upgrade

The bundled nginx uses stock `nginx:alpine` with `./nginx.conf` **bind-mounted from the host**
(`docker-compose.yml`: `- ./nginx.conf:/etc/nginx/conf.d/default.conf:ro`) — it is **not** baked
into an image. Consequences for operators upgrading:

- **Backend image** (header/cover resize, og-image endpoint, from-image fallback) → ships in
  `contactsheet-backend`; arrives automatically with `docker compose pull` + `up -d`. No config
  change.
- **nginx body-size fix** (header/cover > 1 MB) → lives in the host's `nginx.conf`. An image pull
  does **not** deliver it. The operator must update the host file from the release **and run
  `docker compose restart nginx`** — `docker compose up -d` alone does **not** reload it (Compose
  recreates the container only when the service *definition* changes, not when the bind-mounted file's
  contents change; verified in prod — nginx kept running the old config after `up -d`). Without the
  restart, the WhatsApp/og:image fix still arrives via the backend image, but "can't upload a header
  > 1 MB" persists.
- **docker-compose.yml**: no change required (services, volume mount, `BACKEND_INTERNAL_URL`
  unchanged). The new og-image endpoint is under `/api/…`, already proxied by `location /api/` — no
  new nginx location.

Flag the `nginx.conf` update prominently in the release notes.

## Out of scope

- Branding-logo / watermark resizing (the nginx fix lets them upload; resizing them is separate).
- The Set Header/Cover button placement question (intentional; noted above).
- Any change to photo-rendition sizing or `high_res_previews`.

## Testing

- Backend: header/cover upload of a >1 MB file succeeds and is stored bounded; `use_image_as_header`
  with no `medium` present yields a bounded (not original-sized) file; new og-image endpoint returns
  a < ~300 KB JPEG, honours ETag (304), and 404s for password-protected galleries.
- Manual: paste both the existing Matthias link and a fresh large-header gallery into a **new**
  WhatsApp chat → preview renders. (WhatsApp caches per URL/chat, so verify in a fresh chat.)

## Files touched (anticipated)

- `nginx.conf` — body-size location for header/cover (+ branding/watermark) uploads.
- `backend/app/tasks/image_processing.py` — extract in-memory `resize_bytes` helper.
- `backend/app/routers/galleries.py` — resize in `upload_header_image` / `upload_cover_image`.
- `backend/app/services/image_service.py` — resize in `use_image_as_header` (incl. original fallback).
- `backend/app/routers/public.py` + `app/services/gallery_service.py` — og-image endpoint; point
  `image_url` at it.
- `backend/tests/` — coverage per above.
