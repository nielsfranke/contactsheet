# Public write rate limits + uploader filter

Status: **implemented** — 2026-06-15

Hardens the public (client-facing) write surface — the part of #1 that's a real security gap. The
per-IP rate limiter **already exists** (`app/rate_limit.py`, slowapi, keyed on the reverse-proxy
real IP) but is only applied to `login` and gallery-password `auth`. Every other public write — client
upload, comments, flags/likes, votes, collection create/delete, ZIP — is currently unthrottled, so a
visitor with gallery access can spam at will. This applies the existing decorator to all of them and
adds a small admin convenience: filtering the gallery grid by uploader.

## Decisions (locked with the user)

- **Cover all public writes**, not just uploads — they're equally spammable and it's the same
  one-line decorator. Uploads/ZIP (heavy) get a stricter limit than lightweight toggles.
- **Dropped: "notify the uploader on approve/reject."** Client uploaders are anonymous (a reviewer
  name, no contact channel), so there's nothing to notify. Not feasible under the current model;
  removed from scope rather than half-built.

## Rate limits (per IP, per route)

Applied with `@limiter.limit(...)` exactly like the existing `auth.py` login (`10/minute`). Literals,
matching the current hardcoded style (no env knobs — keep it simple, single-process):

| Endpoint | Limit | Rationale |
|---|---|---|
| `POST …/images` (client upload) | `10/minute` | Heavy (up to 50 files × size cap each) |
| `POST …/zip` | `10/minute` | Heavy (spawns a background ZIP job) |
| `POST …/collections` | `20/minute` | Moderate write |
| `DELETE …/collections/{id}` | `30/minute` | Cheap but destructive |
| `POST …/images/{id}/comments` | `30/minute` | Text spam vector |
| `DELETE …/images/{id}/comments/{id}` | `30/minute` | — |
| `POST …/images/{id}/flag` | `120/minute` | A reviewer legitimately flags many photos fast |
| `POST …/images/{id}/like` | `120/minute` | Same — generous so power reviewers aren't blocked |
| `PUT …/images/{id}/vote` | `120/minute` | Same |

The numbers are tuned so a *legitimate* reviewer racing through a large gallery (flag/like/vote per
photo) never trips, while a script hammering uploads/comments does. `auth` (`20/minute`) and `login`
(`10/minute`) stay as-is.

## Backend

- Each limited route gains `request: Request` as its first parameter (slowapi reads the key from it)
  and an `@limiter.limit("…/minute")` decorator — the pattern already in `auth.py` / the gallery
  `auth` route. `app.state.limiter` + the `RateLimitExceeded` handler are already wired in `main.py`,
  so a tripped limit returns **HTTP 429** automatically (no per-route handling).
- The 429 body is slowapi's default. Frontend mapping: add a `rate_limited` case to `errors.*` and
  surface a friendly "Too many requests — slow down a moment" toast when a write returns 429
  (`getErrorCode` already centralizes this; 429 has no `code`, so map on `err.status === 429`).
- **No migration, no new dependency** — slowapi is already in `requirements.txt`.

### Note on the existing CLAUDE.md wording

The client-uploads / collections sections say "no app-wide rate limiter (size + 50-file caps
mitigate)". That predates this change — update those notes to "per-IP rate-limited" once shipped.

## Uploader filter (admin)

Small admin-grid convenience (client uploads already badge `↑ {uploaded_by}`): let the photographer
filter the in-gallery grid to one uploader.

- **Frontend only** — the admin image list already carries `uploaded_by`. In `useGalleryDetail`,
  derive the distinct non-null `uploaded_by` values; add an `uploaderFilter` state intersected into
  the existing `filteredSorted` memo (alongside filename / flag / comments filters). Surface it in
  `GalleryViewToolbar` as a dropdown ("All uploaders" + one row per name, with "Photographer" for the
  null bucket) — shown only when the gallery has ≥1 client upload.
- No backend change.

## Out of scope / follow-ups

- Env-configurable limits; a shared store for multi-container deploys (single-process by design).
- Global (cross-route) per-IP budget; CAPTCHA / proof-of-work on upload.
- Notifying anonymous uploaders (no contact channel) — see Decisions.
