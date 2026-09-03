<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

All notable changes to ContactSheet are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.11.0] - 2026-09-03

Analytics grows up, and the admin gallery overview gets a phone-friendly list. **A migration
(0049) runs on upgrade; no action needed.**

### Added

- **Analytics: the range selector now applies to everything.** Totals, top photos, busiest
  galleries and the new reviewer ranking all follow the 7 / 30 / 90-day window — previously only
  the two charts did, and the totals were silently all-time.
- **Period-over-period trends on every stat tile** (`+40 %`, `−12 %`, `new`), comparing the
  window with the equally long one before it.
- **Engagement over time** — a third chart summing flags, likes, ratings, votes, comments and
  annotations per day.
- **Reviewers table** (per gallery and instance-wide): who flagged, rated, liked, voted,
  commented or uploaded how much, and when they were last active. Anonymous rows (guest views,
  shared flags without a name, the photographer's own moderation) are excluded.
- **Review status** per gallery: how many photos carry any mark, the colour-flag split, the star
  histogram, photos with likes / comments and the number of team voters — a snapshot of the live
  images, not activity history, so it stays right after a flag is set and cleared again.
- **Phone list view for galleries.** Settings → Workspace (or the toggle in the overview toolbar
  on a phone) switches the All Galleries page and a gallery's sub-galleries to compact rows below
  the tablet breakpoint. Desktop always keeps the cover grid.

### Changed

- Uploads and team-votes tiles on the analytics dashboard appear only once either has activity.
- The busiest-galleries table's engagement column is computed server-side (`engagement` on the
  rollup) instead of being re-derived in the browser.

## [1.10.0] - 2026-09-02

A hardening release from a full-codebase review: the public surface stops leaking around the
gallery gates, the in-place restore can no longer corrupt a live database, and the admin app gets
a long list of correctness fixes. **A migration (0048) runs on upgrade; no action needed.**

### Security

- **Password-protected and expiring galleries no longer hand out static `/uploads/…` URLs.**
  nginx serves that mount with no authentication and a 30-day immutable cache, so any once-seen
  rendition or original link (shared, cached, logged) opened the photo without the password and
  kept working past the expiry date. `gallery_service.variants_protected` is now the single gate
  (downloads off / watermark / password / expiry) and every public serializer routes such media
  through the access-checked `/api/public/g/{token}/images/{id}/{thumb|small|medium|original}`
  proxy. The new `/original` proxy carries the per-photo download and `<video>` source for
  protected galleries (Range-capable, `Cache-Control: private`).
- **A parent gallery's ZIP no longer bundles children the viewer couldn't open.** Both the job and
  the streaming download accepted any direct child named by share token — including a
  password-protected child, one with downloads off, or an expired one — turning the parent's link
  into a skeleton key for the child's originals. A child's own gates now apply.
- **EXIF (with GPS coordinates) and IPTC are stripped server-side** unless `show_exif` /
  `show_iptc` is on; previously only the UI hid them and the public API returned the location of
  every frame to anyone with the link.
- **Gallery tokens are bound to the password they were issued against.** Changing the password
  invalidates outstanding 12-hour tokens (REST and WebSocket); removing it reopens the gallery.
- **Every client write goes through `review_active`.** Per-reviewer votes and public collections
  only checked their feature toggle, which cascades onto Showcase sub-galleries while `mode` does
  not — a Showcase child of a Review container accepted votes and collections. Public collections
  also refuse pending (unmoderated) uploads, and the public ZIP job download re-checks
  `downloads_enabled`.
- **Anonymous client uploads accept JPEG, PNG and WebP only.** The TIFF/PSD/RAW decoders (Pillow
  plugins, LibRaw) stay admin-only.
- **Factory reset sets a random token generation.** With `SECRET_KEY` pinned in the environment the
  rotated database key was overridden again at the next start, and a pre-reset "remember me"
  cookie was valid again on the not-yet-set-up instance.
- **Gallery JWTs no longer reach the logs or Sentry.** The `?token=` query string (media proxy, ZIP
  stream, public WebSocket) is dropped from nginx's access log and from Sentry events.
- The notification SSRF guard is now an allow-list of credential-only SaaS schemes; every other
  Apprise netloc (gotify, matrix, mqtt, unknown schemes…) is vetted. Custom notification templates
  can no longer traverse attributes through `str.format` (`{x.__class__…}`). Header/cover uploads
  and the watermark PNG get the same decompression-bomb guard as photo uploads (Pillow only raises
  at *twice* `MAX_IMAGE_PIXELS`). The watermark file name is confined to the gallery's directory.
  `/api/health/ready` is cached for 5 s so it can't be used as an amplifier.
- nginx honours the fronting proxy's `X-Forwarded-Proto` (the bundled nginx forwarded its own
  `http`, so behind Nginx Proxy Manager the admin cookie was never flagged `Secure` unless
  `COOKIE_SECURE=true` was set), and `/uploads` carries the same `script-src 'none'` CSP as
  `/branding`.

### Fixed

- **Restore could corrupt a live database.** The web restore overwrote the SQLite file in place
  while the rendition pool, embed pool, notification flusher or an in-flight request could still
  hold a connection — SQLite's WAL is bound to the file by *name*, so a straggling writer appended
  frames the restored database then replayed. The rollback copy was also taken without a WAL
  checkpoint, so a failed migration "rolled back" to a database missing the newest commits.
  Restore now quiesces the instance (requests get a 503 + `Retry-After`, pools refuse new work, the
  flusher skips), refuses with `409 instance_busy` if it doesn't go idle in 30 s, takes the rollback
  snapshot with `VACUUM INTO`, and swaps the file with `os.replace`. The forward-only gate reads the
  revision from the snapshot itself, and a pinned `SECRET_KEY` keeps precedence after restore.
- **Drag-reorder in a filtered admin grid scrambled the gallery order and hid photos.** With a
  name/flag/rating filter or a collection active, a reorder sent only the visible ids (the backend
  renumbered just those) and replaced the images cache with the subset. Reordering is now off while
  a filter narrows the grid.
- **A gallery that expired while open reconnected its WebSocket once a second, forever.** `4410` is
  now a permanent close code and the backoff only resets after a socket has stayed open 5 s.
- Backup builds under a `.part` name and remove it on failure (no more stranded multi-GB
  half-archives); renditions are written tmp + rename (the startup preview sync rewrote files that
  were being served); a DB error inside image processing no longer strands the row in "pending".
- sqlite-vec: an unbuilt index falls back to NumPy instead of blanking instance-wide search, and a
  missing/stale index is rebuilt at startup.
- Pinned covers are bound to their gallery (a moved pin falls back to the auto cover); `sort_order`
  is no longer cascaded to sub-galleries; moving photos drops them from the source's collections
  and purges its watermark cache; replace-in-place updates the row before deleting old files; the
  like toggle absorbs the unique-constraint race; a non-ASCII gallery name no longer 500s the ZIP
  download (RFC 6266 `filename*`); `sort_order` and id lists are bounded (422, not a driver
  overflow); the shadowed duplicate `POST /galleries/{id}/reorder` is gone.
- Admin app: API error toasts are never blank (HTTP/2 has no `statusText`); a backend restart no
  longer bounces the admin to `/login` (only a 401 does, and the deep link comes back via `?next=`);
  a second folder dropped mid-upload is refused instead of clobbering the running batch; pending
  name/subtitle/expiry edits are saved when the settings modal closes via Escape (and on Enter);
  watermark text/colour/opacity are debounced; a cascade refreshes the children's cached settings;
  concurrent autosaves no longer revert each other; the selection drops ids that disappeared and
  bulk actions act on the visible selection; backup polling stops on unmount and the job survives
  navigation; batch rename refuses collisions and empty stems; rename dialogs ignore Enter while
  saving; dropping a gallery into its own subtree is refused client-side; Undo surfaces its error;
  the API-token copy button works on plain-http origins.
- Client gallery: "Download all" pre-flights the gates so an expired token or a disabled download
  shows in the dialog instead of navigating the gallery to a JSON error page; client uploads are
  sent in batches of 50 (the backend's cap); the open lightbox follows a flag another reviewer set;
  team votes show optimistically and roll back on error; far mobile slides render empty; grouped
  windowed grids re-measure their offset when a group above changes height.
- Accessibility: admin photo tiles are keyboard-operable in select and manual-sort modes; the
  off-screen tools drawer is `inert`; the download and save-collection dialogs carry
  `role="dialog"`, labels and Escape.
- Uploads spool on the data volume rather than the container's `/tmp`; the embedding job retries
  from the `medium` rendition when the sidecar can't decode a huge original.

### Changed

- Router → service → repository layering restored where it had slipped: header/cover/watermark
  file handling, watermark compositing, public ZIP composition and job deletes moved out of the
  route handlers.
- The team-voting summary carries per-reviewer star ratings.
- Compose: json-file log rotation on every service and env-overridable memory ceilings
  (`BACKEND_MEMORY_LIMIT` 6g, `ML_MEMORY_LIMIT` 4g, `FRONTEND_MEMORY_LIMIT` 1g,
  `NGINX_MEMORY_LIMIT` 512m). nginx streams ZIP downloads unbuffered.

### Tests & CI

- An auth sweep hits every non-public route anonymously (401 expected); a migration-drift test
  runs the real `alembic upgrade head` against the models — it found `header_focus_x/y` nullable
  in 0012 versus NOT NULL in the model, fixed by migration 0048; happy-path coverage for the
  previously untested endpoints; a watermark test that compares served bytes; `pytest-timeout`;
  CI runs `validate-i18n` and gives the E2E job one rerun; Dependabot for actions, pip, npm and
  Docker base images.

## [1.9.4] - 2026-08-23

An accessibility and polish release: a full keyboard/screen-reader pass over both surfaces, real
states for the dead-end share-link screens, and a working realtime layer under `next dev`.

### Security

- **Next.js bumped 16.2.12 → 16.3.0**, which clears every advisory the frontend audit was carrying:
  the bundled postcss goes 8.4.31 → 8.5.23 (three known sourceMappingURL / stringify issues plus a
  fourth, newly published incomplete-fix advisory) and sharp 0.34.5 → 0.35.3 (the inherited libvips
  CVEs). Both were previously unfixable from this repo because Next pinned them.
- **nanoid bumped 3.3.15 → 3.3.18** (transitively, under postcss), closing two denial-of-service
  advisories where non-secure or custom generators can loop indefinitely for a negative or zero
  size. Not reachable here — nothing passes a caller-controlled size — but the fix is free.
- The npm audit allowlist in `frontend/scripts/audit-prod.mjs` is now **empty**, and the job still
  fails on any new high/critical advisory. Nothing is being suppressed.

### Accessibility

- **The public client path works end-to-end with a keyboard and screen reader.** The mobile tools
  drawer manages focus properly (focus moves in on open, Escape closes, focus returns to the
  trigger), photo-tile hover controls reveal on keyboard focus so tab never lands on invisible
  buttons, like/comment/annotate buttons carry real accessible names (like also exposes
  `aria-pressed`), and one semantic flag vocabulary (Select/Reject/Maybe/Favourite) is used across
  grid, toolbar chips, group headers and lightbox. Container galleries report "2 galleries" instead
  of a misleading "No photos", and the dark-header count color now clears AA.
- **The admin path got the same pass**: one keyboard stop per gallery (a real link on the name
  instead of dead dnd-kit stops; drag stays pointer-only), `aria-label`s on every icon-only
  control, `aria-expanded` on tree/drawer toggles, focus-visible rings on hover-revealed actions,
  and a mobile drawer with real focus management that leaves the tab order while closed.

### Fixed

- **A bad or expired share link is no longer a dead end.** The not-found state was a lone
  "Gallery not found." line on black. The three pre-gallery screens (password gate, expired,
  not found) now share one status-screen scaffold: icon, title, recovery guidance ("check the
  link, or ask the photographer for a new one"), and the legal strip pinned at the bottom — the
  Impressum and AGPL §13 source offer stay one click away exactly where a confused visitor lands.
- **Realtime updates were silently dead under `next dev`**, twice over: the WebSocket URL
  hardcoded port 8000 (ignoring `NEXT_PUBLIC_API_BASE`), and the CSP's `connect-src 'self'`
  blocked the direct-to-backend dev socket even on the default port (the dev proxy rewrites HTTP
  but can't upgrade WS). The WS base now mirrors the proxy target and the CSP names that origin
  in development only; production stays same-origin behind nginx.
- **The instance analytics page explains the dimmed Views metric** the way the per-gallery panel
  always did: "Visitor views aren't being recorded" plus an Enable IP logging link, instead of an
  unexplained "—".
- **`/uploads/` and `/branding/` no longer send two competing `Cache-Control` headers** (`expires`
  + `add_header` both emitted one; the max-age is folded into a single header, and a 404 under
  these mounts no longer picks up a 30-day cache), and the `/branding/` CSP now also rides error
  responses.

## [1.9.3] - 2026-07-27

### Security

- **Next.js bumped 16.2.9 → 16.2.12**, closing four advisories: a server-side request forgery in
  rewrites via an attacker-controlled destination hostname, an unbounded Server Action payload on
  the Edge runtime, a denial of service in the Image Optimization API via SVG, and unauthenticated
  disclosure of internal Server Function endpoints.
- The npm audit job now runs through `frontend/scripts/audit-prod.mjs`, which fails on any
  high/critical advisory outside a **reviewed allowlist** — and equally when an allowlisted advisory
  stops being reported, so the list cannot quietly go stale. The two remaining entries (`sharp`'s
  inherited libvips CVEs and `postcss`) live inside packages Next bundles and can only be fixed
  upstream; neither is reachable here — the Image Optimization API is disabled outright
  (`images: { unoptimized: true }`), so sharp is never invoked, and postcss only ever sees this
  repo's own Tailwind sources at build time.

### Fixed

- **A gallery subtitle can be removed again.** Clearing the field and leaving it saved nothing: the
  settings dialog sent `null`, which the API reads as "field omitted, no change", where clearing
  requires the empty string. Once set, a subtitle could never be taken off. Pinned with a test for
  the clear-vs-omit contract, which had none.

## [1.9.2] - 2026-07-27

A maintenance release: no new features, but a broad sweep of security hardening, correctness fixes
and performance work across the review lightbox, the realtime layer and the public gallery.

### Security

- **Per-gallery review toggles are now enforced on the API, not just in the UI.** With colour flags,
  likes or comments switched off, anyone holding the share link could still `POST` a flag, rating,
  like or comment (and read stored comments) — overwriting the shared flags you cull with, and
  injecting comments that fired notifications. All three are gated server-side now, like the
  annotation and team-voting toggles already were.
- **Renditions of protected galleries stay behind the access-checked proxy.** Cover images (public
  gallery, sub-gallery cards, parent navigation, public collections, link-preview source) were built
  on the static `/uploads` path, so swapping `thumb` for `original` in the URL fetched the full-size,
  un-watermarked file past the download gate. Covers now route through the public proxy whenever the
  owning gallery is protected, and password-protected parents/children expose no cover on navigation
  cards at all. Cover lookups also respect moderation, so a pending client upload can never surface
  as a public cover.
- **Cross-origin admin WebSocket handshakes are rejected** (close 4401). Cross-site WebSocket
  handshakes are not covered by CORS, so `SameSite=Strict` was the only thing stopping a malicious
  page from opening the admin socket with your ambient cookie.
- **Login no longer leaks which usernames exist.** A wrong username returned 401 in microseconds
  while a correct one paid for a full password hash — a reliable existence oracle within the
  rate-limit budget. Both paths now cost the same.
- **`TRUSTED_PROXY_HOPS=0` is respected again.** The container always trusted forwarded headers, so
  in the documented "directly exposed" mode a spoofed `X-Forwarded-For` could bypass rate limiting
  and poison the activity IP log. Forwarded headers are trusted only when a proxy is declared (the
  default; the shipped Compose setup is unaffected).
- **The nginx static locations stopped dropping security headers.** `add_header` inheritance is
  all-or-nothing, so `/uploads/` and `/branding/` silently lost `X-Frame-Options` and
  `Referrer-Policy`. Both now repeat the full set, and every copy is marked `always` so error
  responses carry them too.

### Fixed

- **Escape inside an editor cancels the editor, not the lightbox.** Cancelling a comment draft or an
  annotation note also threw you out of the lightbox and discarded the text.
- **An open lightbox now follows live data.** The slide list was snapshotted on open and never
  updated, so flags you set (or another reviewer's changes arriving over the socket) visually
  reverted when you swiped away and back; like and comment counts went stale the same way.
- **Exposure times of a second or longer display correctly** — 2s rendered as "1/1s".
- **The gallery settings dialog fits on a laptop screen.** Tall tabs pushed the title and close
  button off-screen with no way to scroll back to them. It also re-reads the gallery every time it
  opens: previously a stale copy was displayed after a rename or a cascade, and leaving the name
  field could commit that stale value back and undo the rename.
- **ZIP status polling stops when you leave the page.** Navigating away from a preparing export left
  a loop hitting the status endpoint indefinitely and triggering the download into a page you had
  already left.
- **The admin ZIP job list no longer 500s** once a gallery has at least one export job.
- **Watermarked previews refresh on replace-in-place.** The composited cache is keyed on the image
  id — which replacing a photo deliberately keeps — so a re-upload kept serving the old photo's
  pixels indefinitely. Cache entries are now purged with the renditions, and cache files are written
  atomically so a concurrent request can never see (and cache for an hour) a half-written JPEG.
- **Changing watermark settings clears the old composited cache** instead of stranding every
  previous variant on disk forever.
- **Setting a gallery header writes the new file before deleting the old one**, so a failure mid-way
  no longer leaves the gallery pointing at a deleted file.
- **Expired sub-galleries disappear from their parent's public page.** They were still listed as
  cover cards that simply returned "gone" when opened.
- **Startup rendition sync skips videos and reads RAW through the proper decoder.** Videos logged
  three stack traces per clip on every boot, and RAW originals silently missed both rendition-size
  changes and the wide-gamut colour self-heal.
- **A permanently rejected WebSocket is replaced on the next subscribe**, so live updates come back
  after a re-login or a gallery password re-entry instead of staying dead.
- **Upload, delete and move events refresh the counts that depend on them** — the public
  container view (sub-gallery cards) and the admin sidebar/overview counts no longer need a manual
  refresh.
- **Failed writes are surfaced instead of failing silently.** Rejected team-voting flags and stars,
  comment posts/edits/deletes and manual reorders left the optimistic value on screen with no hint
  that nothing had saved.
- **Uploads survive a non-JSON response.** A 2xx whose body isn't JSON (a proxy interposing an HTML
  page, say) left the upload hanging forever; error messages from the XHR paths also no longer read
  `[object Object]`.
- **`no_preview` is a valid processing status on the backend too** — serializing it (reachable when
  replacing a file that has no embedded preview) raised a 500.
- **The nginx auth rate limit no longer locks out a whole client team.** Behind a fronting proxy the
  zone collapsed every visitor into one bucket, so a handful of people entering a gallery password
  together got bare 503s. The backend's own per-client limiter still does the real work.

### Accessibility

- **The lightbox, the reviewer-name prompt and the mobile filter sheet are proper dialogs.** They
  now carry `role="dialog"`/`aria-modal`, take focus on open, return it to the trigger on close, and
  trap Tab inside — previously the page behind stayed fully reachable in the tab order.

### Performance

- **Large galleries stay responsive while filtering.** Every keystroke re-rendered all mounted
  photo tiles; tiles are memoised now and receive identity-stable handlers.
- **Bulk operations batch their writes.** Moving images between galleries, approving moderated
  uploads and cascading settings to sub-galleries each committed once per row (and, for moves,
  re-counted the target gallery every time). Behaviour is unchanged.

### Internal

- Tagging a release now requires a green Tests run on the tagged commit before any image is pushed.
- CI caches the Playwright browser download (~170 MB per E2E run).
- Added tests pinning the WebSocket auth rejections and cross-gallery token reuse across REST, the
  ZIP stream and the image proxy.

## [1.9.1] - 2026-07-13

### Security

- **Pillow bumped 12.2.0 → 12.3.0** in the backend, closing five advisories flagged by `pip-audit`
  (PYSEC-2026-2253 … 2257): four decompression-bomb bypasses in the PCF/BDF/GD/FontFile loaders and
  a Windows-only shell-injection in `WindowsViewer`. None are reachable on ContactSheet's photo
  pipeline, but the pins are now clean.
- **Optional ML sidecar dependencies refreshed** (`ml/requirements.txt`): Pillow 11.0.0 → 12.3.0,
  transformers 4.47.1 → 4.57.6, huggingface_hub 0.27.0 → 0.36.2, sentencepiece 0.2.0 → 0.2.2 and
  fastapi 0.115.6 → 0.139.0 (pulling a patched Starlette) — dropping the sidecar from ~40 known
  advisories to two residual ones that require the transformers 5.x major bump. Verified with an
  end-to-end embedding run: image and text encoders still produce valid, correctly-ranked vectors,
  and existing embeddings stay compatible (no re-index needed).

### Changed

- The **security-audit** CI workflow now also scans `ml/requirements.txt`, so the optional
  semantic-search sidecar's pinned stack is watched alongside the backend.

## [1.9.0] - 2026-07-09

### Added

- **Impressum and privacy pages.** Two new free-text fields (**Settings → General → Legal pages**)
  publish an imprint at `/impressum` and a privacy policy at `/privacy`, linked from the bottom of
  every client gallery. Leave a field empty and its link disappears and the page 404s. The text is
  rendered as plain text with your line breaks preserved — never as HTML.
- **A "Support" link for the ContactSheet project**, in the same footer strip. It is **on for new
  installations and stays off for instances that already exist**, so an upgrade never adds a
  donation link to galleries you have already delivered. Toggle it under Settings → General.
- The same footer strip now also appears on the **login and first-run setup screens**, so the
  imprint and the source link are reachable from every public page of the app.
- **The auto-picked gallery header is now visible in the admin view.** With "auto-fill header"
  enabled, the fallback was only computed for the client-facing gallery, so you couldn't tell
  whether the automatic pick had worked without opening the share link. The gallery detail page now
  shows the same banner the client sees, badged "Auto-picked"; one click still overrides it.

### Fixed

- **The AGPL source link is now actually shown to clients.** `Settings → General → Source URL` was
  stored and editable but rendered on no public page — AGPL §13 requires offering the running
  source to *network users* (your clients), not just to the admin. Every public gallery now carries
  a "Source" link in the new footer strip. It is deliberately **not** hidden by the
  branding-footer toggle, and it points at your custom source URL when a fork sets one.

### Upgrade notes

- **Database migration 0047** (`impressum` / `privacy` / `support_link_enabled` on `app_settings`)
  applies automatically on container start — `alembic upgrade head` runs in the entrypoint. No
  manual step, no `nginx.conf` change, no new environment variables.
- **Existing instances keep the "Support" link off.** It only defaults on for brand-new
  installations, so upgrading never adds an upstream donation link to galleries you have already
  delivered. Enable it under Settings → General if you'd like to.
- The **"Source" link is new on every public gallery** and cannot be switched off — it is the AGPL
  §13 source offer, which was previously missing from the client-facing pages. If you run a modified
  build, point Settings → General → Source URL at your own repository.

## [1.8.1] - 2026-07-08

### Fixed

- **The “auto-fill header” switch (Settings → Gallery defaults → Viewing) now stays on.** It saved
  correctly but the settings API never echoed the value back, so the toggle flipped on and then
  immediately snapped off again. The feature itself was unaffected — only the switch was stuck.
- **Dropping something that isn’t an image file onto the header/cover drop zone now shows a clear
  hint** instead of a raw “field required” error. To reuse a photo already in the gallery, use its
  “Set as header/cover” action (or the cover dialog’s “choose a photo” grid) rather than dragging it
  onto the drop zone, which is for files from your computer.

## [1.8.0] - 2026-07-08

### Added

- **Optional auto-fill for the gallery header.** A new instance setting (**Settings → Gallery
  defaults → Viewing**, off by default) lets a gallery use one of its own photos for the opener when
  no header image is set by hand — so galleries look finished without manual work. The pick is
  stable per gallery (it won't change between visits or churn link previews) and deliberately differs
  from the cover, and it respects watermarks. A header you set manually always takes precedence. See
  `docs/proposals/auto-header-image.md`.

### Fixed

- **Dragging a photo onto the header/cover drop zone now works** instead of failing with an
  “[object Object]” error. A photo dragged from the browser arrives without a filename, which the
  server rejected as an invalid upload; the drop now always carries a filename, so the dragged photo
  becomes the header/cover as intended. Upload errors (e.g. a file over the 100 MB header limit) also
  render as readable messages now rather than “[object Object]”.

## [1.7.1] - 2026-07-08

### Fixed

- **Uploading a large folder no longer fails with a bare “Network error.”** The admin gallery upload
  used to send the entire drag-and-drop batch as a single request; a big folder (e.g. 105 × 50 MB ≈
  5 GB) then exceeded the request-body ceiling of a reverse proxy in front of the app and the whole
  batch was rejected before a single photo was saved. The batch is now split into byte-bounded
  (~256 MB) sub-requests that upload **sequentially**, so a folder of any size stays comfortably
  under any realistic proxy limit — no proxy reconfiguration needed. Photos appear in waves as each
  part completes, and if a later part fails the earlier ones are kept: the toast reports how many
  landed so you can retry only the remainder.
- **Photos above 100 MP now generate previews.** The per-image pixel ceiling was raised from 100 MP
  to **250 MP**, so high-end medium-format originals (e.g. 12000 × 9000 = 108 MP) and large panorama
  stitches are processed instead of failing rendition with an “exceeds pixel area limit” error and
  showing a broken thumbnail. Attacker-reachable client (public) uploads keep their stricter 50 MP
  cap. Env-overridable via `MAX_IMAGE_PIXELS` for memory-constrained hosts.

## [1.7.0] - 2026-07-08

### Added

- **Per-mode sub-gallery presets.** A container gallery can now hold a separate look & behaviour
  template for each mode — a Showcase template and a Review template — under **Gallery settings →
  General → “Sub-gallery defaults”**. New sub-galleries you create inside it start from the template
  that matches their mode, so a customer folder can mix Review sub-galleries (e.g. “Work in
  Progress”) and Showcase sub-galleries (e.g. “Final Deliveries”) without styling each one by hand.
  Templates are inherited down the whole folder tree and can be pushed to existing sub-galleries with
  “Apply to all sub-galleries”. See
  `docs/proposals/gallery-per-container-mode-presets.md`.

### Changed

- **“Apply to all sub-galleries” now reaches every nested level**, not just the direct children —
  in deeply nested folders, grandchildren and deeper previously never received the settings.
- **“Apply to all sub-galleries” no longer changes a sub-gallery’s mode.** Only look & behaviour are
  propagated now, so a folder can hold mixed Review and Showcase sub-galleries and applying settings
  won’t flip them all to the parent’s mode.
- **A sub-gallery created in a different mode than its parent now starts from the standard preset for
  that mode** (or the folder’s own template for it, if set) instead of inheriting the parent’s
  wrong-mode look.
- **Manually uploaded gallery header & cover images now allow up to 100 MB** (was ~10 MB), so
  full-resolution developed JPEGs can be used directly without shrinking them first. The server still
  bounds the stored image to 3840 px, so this only lifts the upload cap.

  **Operator action required:** the bundled `nginx.conf` is host-mounted, so pulling the new images
  alone does **not** raise the limit for header/cover uploads. Update `nginx.conf` on the host (its
  header/cover/watermark/logo location now uses `client_max_body_size 110m`) and recreate the nginx
  container; if a reverse proxy (e.g. Nginx Proxy Manager) sits in front, raise its body-size limit
  to ≥100 MB on those paths too.

## [1.6.9] - 2026-07-07

### Fixed

- **Public gallery images failed to load during a large upload.** Bulk-uploading many photos at once
  (e.g. via the Lightroom / Capture One plugins or another API client) could saturate the database
  connection pool: the admin UI's live-refetch storm, serialized rendition writes, and background
  semantic-search indexing all competed for a pool that defaulted to just 15 connections. Requests
  then timed out (`QueuePool limit ... reached`), so **both** the admin and the client (public) view
  degraded — broken thumbnails and full-size images — until the upload backlog drained. Three fixes:
  the connection pool is now sized for bursts (`DB_POOL_SIZE`/`DB_MAX_OVERFLOW`, env-tunable), the
  embedding worker no longer holds a pooled connection across its call to the ML sidecar, and the
  admin live-update refetches are coalesced so a burst of uploads no longer fans out into one refetch
  per photo. No configuration change is required to benefit.
  See `docs/architecture/db-connection-pool-under-bulk-upload.md`.

## [1.6.8] - 2026-07-07

### Changed

- **Photoshop (.psd/.psb) and TIFF uploads now allow up to 8 GB** (was 300 MB), configurable via
  `MAX_DOCUMENT_BYTES` — large layered working files upload without being rejected. Regular photos
  stay at 300 MB; client uploads keep their small cap.

  **Operator action required:** the bundled `nginx.conf` is host-mounted, so pulling the new images
  alone does **not** raise the limit. Update `nginx.conf` on the host (its `client_max_body_size` is
  now `8g`) and recreate the nginx container. If a reverse proxy fronts the stack (e.g. Nginx Proxy
  Manager), raise its upload/body-size limit to at least 8 GB there too, or it will reject first.

## [1.6.7] - 2026-07-07

### Fixed

- **Adobe RGB (wide-gamut) photos looked desaturated.** Previews were written straight from the
  source pixels with no colour profile, so an image exported in Adobe RGB (or ProPhoto / Display-P3)
  rendered washed-out — browsers assume sRGB for an untagged image. Renditions are now colour-managed
  to sRGB and tagged accordingly, so wide-gamut photos display with correct, saturated colour.
  Header, cover and link-preview images are converted too. Photos already uploaded are re-rendered
  automatically on the next restart; originals are never altered.

## [1.6.6] - 2026-07-07

### Added

- **Duplicate-filename upload resolution.** Uploading a photo whose filename already exists in
  the gallery now prompts how to proceed instead of silently adding a second copy: **Replace**
  (overwrite the existing photo in place — its comments, ratings, votes, collection membership
  and any pinned gallery cover are kept, so a re-uploaded cover follows automatically),
  **Keep both** (the new file is renamed `_v2` / `_v3`), or **Skip**. Choose once for the whole
  batch or per file. Third-party clients (Lightroom/Capture One personal-access-token uploads)
  are unaffected — without the new option they keep appending as before.

### Fixed

- **Moving photos between galleries dropped a preview size.** Moving (or copying) an image to
  another gallery relocated only some of its renditions, leaving the intermediate `small`
  preview behind in the old gallery — so thumbnails/previews could fail to load in the
  destination (notably on phones and with high-res previews on). All rendition sizes now follow
  the move, and the rendition worker is hardened so moving a photo mid-processing no longer
  strands its previews. Already-affected photos repair themselves automatically on upgrade.

## [1.6.5] - 2026-07-03

### Added

- **Rating style "Both" — color flags and stars together.** Settings → Gallery defaults →
  Rating style gains a third option that shows both systems side by side, Lightroom-style:
  flags for select/reject, stars for grading. Grid tiles stack the star picker above the
  flag dots on hover and combine the resting badge into one line; the lightbox toolbar
  shows both control groups; filters offer flag *and* star chips (combinable — they narrow
  together), grouping can bucket by flag or by rating, and sort-by-rating is available
  whenever stars are visible. Values stay independent and switching styles remains
  non-destructive — nothing is converted or cleared. Works with team voting: each reviewer
  keeps their own flag and star. No migration needed.

### Fixed

- **Star-filtered downloads exported the whole gallery.** With only a star filter active,
  "Download" in client galleries and the admin gallery view ignored the filter and fell
  through to the full export; both now download exactly the filtered photos.

## [1.6.1] - 2026-07-03

### Fixed

- **Settings: "Maximum zoom" options overflowed on phones.** The picker forced four
  columns, pushing "Original size" past the screen edge on narrow viewports; it now wraps
  to 2×2 on phones.

## [1.6.0] - 2026-07-03

### Added

- **Zoom in the Review lightbox (desktop).** A picdrop-style zoom control in the lightbox
  bottom toolbar — magnifier (reset), slider and live percentage — for Review galleries
  (including the client review-switch) and the admin gallery view; never in Showcase.
  Mouse-wheel / trackpad zoom anchors at the cursor, dragging pans the zoomed photo, and
  the arrow keys always change the photo (never the zoom), even with the slider focused.
  Annotating works while zoomed: the pen owns the drag, wheel and slider keep zooming, and
  strokes land exactly where drawn. Zooming uses the preview renditions — originals are
  never fetched, so download gating and watermarks are never bypassed.
- **Zoom is configurable** under Settings → Gallery defaults → Viewing: switch the control
  off entirely, or cap it at 200 % / 300 % / 400 % (relative to the fitted photo) or the
  photo's real 1:1 original size. Phone/tablet pinch-zoom is unaffected. (Migration 0044.)
- **The comment icon also reveals pen marks.** Opening the comment panel now shows any
  existing annotations on the photo along with their numbered comment rows; closing hides
  them again. The eye toggle keeps working standalone.

### Fixed

- **Even photo frame in the Showcase lightbox.** The filename strip at the bottom now
  matches the top toolbar's height when it is the only bottom chrome, so the photo sits
  vertically centered instead of hugging the bottom edge.
- Deactivating the annotation pen closes the comment panel it opened, mirroring the
  comment icon's toggle.

## [1.5.0] - 2026-07-02

### Added

- **Clients can switch a Showcase gallery into Review mode.** A new per-gallery opt-in
  ("Let clients switch to Review", off by default) shows a "Review photos" button beside the
  download button in the public gallery. It flips the gallery into the full Review experience —
  flags/ratings, likes, comments, collections, per the gallery's feedback toggles — without the
  photographer changing the gallery's mode for everyone; "Back to showcase" in the sidebar returns.
  The client's choice sticks for the session and follows them into sub-galleries. With the switch
  on, the gallery settings modal exposes the Review tab for Showcase galleries so the feedback
  tools can be configured, and the Showcase mode preset can enable the switch for new galleries
  by default. The setting cascades to sub-galleries like the other look & behaviour settings.

## [1.4.3] - 2026-07-02

### Fixed

- **Settings no longer overflow on mobile.** On narrow (<640px) screens several settings controls
  ran off the right edge: labelled rows now stack their control beneath the label instead of
  crushing it, the rating-style buttons (Color flags / Stars) stack full-width so the long label
  no longer clips, and the gallery-defaults preset modal (whose footer buttons blew the dialog past
  the viewport) now stacks its footer on mobile. Desktop layout is unchanged.

## [1.4.2] - 2026-06-30

### Added

- **Read client picks back into Lightroom.** A new `images:read` token scope and a narrow,
  gallery-scoped endpoint `GET /api/galleries/{id}/images/picks` (returning each image's color
  flag, star rating and like count) let the Lightroom plugin pull client picks back into the
  catalog as color labels / star ratings. The token-creation page gains an **Read client picks**
  permission toggle (off by default).

## [1.4.1] - 2026-06-30

### Changed

- **API tokens can now delete images.** `DELETE /api/images/{id}` accepts a personal access token
  with the `images:write` scope (previously admin-cookie only). This lets the Lightroom publish
  service replace an edited photo without leaving a duplicate, and remove a photo from a published
  collection. Gallery deletion stays admin-only.

## [1.4.0] - 2026-06-28

### Added

- **API tokens for third-party tools.** A new **Settings → API tokens** page lets you create scoped,
  revocable personal access tokens (`cs_pat_…`) so external tools can upload to your galleries
  without sharing your admin password. Each token is limited to gallery and image-upload
  permissions — never settings, reset, or account access — and shows up in the Publish flow of the
  new plugin below.
- **Capture One export plugin** *(macOS)*. Publish selected variants straight from Capture One into
  a gallery — pick or create a gallery (Showcase/Review), with editable export recipes — powered by
  the new API tokens. It's a separate, MIT-licensed add-on:
  [contactsheet-captureone](https://github.com/nielsfranke/contactsheet-captureone).

### Changed

- Dependency refresh (FastAPI, SQLAlchemy, Pydantic, React, and others) and a small internal
  cleanup — no behaviour change.

## [1.3.5] - 2026-06-27

### Fixed

- **Large galleries now load every photo on mobile.** In the admin gallery view, galleries with
  more than ~150 photos only rendered the first screenful — scrolling down revealed blank space
  where the rest of the grid should be, most noticeably on phones. The photo grid only keeps the
  on-screen rows mounted (for speed) and tracks the scroll position to know which rows those are;
  it was watching the browser window's scroll, but the admin screen scrolls an inner panel, so it
  never noticed you scrolling and never loaded the rows below the fold. It now follows whichever
  element actually scrolls. The public gallery, which scrolls the window, was unaffected. Verified
  end-to-end against a real mobile browser.

## [1.3.4] - 2026-06-27

### Fixed

- **Admins no longer forced to re-login on Safari (iPad & Mac).** Safari autocompletes to the
  last full URL it saw — typically `…/login` — so a returning admin landed straight on the login
  form. That page never checked for an existing session, so a still-valid cookie (and "Remember
  me") was ignored and the admin had to sign in again every visit. The login page now validates
  the session and redirects an already-signed-in admin to the dashboard. As a companion fix, the
  admin shell now treats the httponly cookie as the sole source of truth instead of a localStorage
  hint — WebKit's ITP evicts localStorage after ~7 days while leaving the cookie intact, which had
  bounced infrequent admins to the login screen. Verified end-to-end against the real browser.

## [1.3.3] - 2026-06-26

### Fixed

- **Admins now stay signed in on Safari (iPad & Mac).** Without "Remember me" the admin
  session cookie was a bare session cookie (no expiry). WebKit drops session cookies
  unreliably — between tabs, on backgrounding, under ITP — so admins were logged out on
  almost every visit and a fresh tab never carried the session. The cookie now always sets an
  explicit lifetime matching its token (30 days with "Remember me", 24 hours otherwise), so it
  survives tab switches and app restarts. Verified end-to-end against the real WebKit engine.
- **Overlapping toolbar on iPad portrait.** In Split View the admin galleries toolbar pinned a
  fixed height while its controls wrapped onto extra rows, so the sort buttons overlapped the
  "move to top level" drop zone below. The shelf now keeps its anchor height on one row but
  grows when the controls wrap.

## [1.3.2] - 2026-06-26

### Fixed

- **"Remember me" now actually keeps you signed in.** The admin login flag was stored in
  `sessionStorage`, which the browser clears when the app or tab is closed — so on the next
  launch the admin area redirected to the login page *before* checking the still-valid 30-day
  session cookie. The flag now lives in `localStorage`, so a ticked "Remember me" survives an
  app restart (notably on iOS/iPadOS/macOS Safari, which fully close apps often). The server
  cookie remains the source of truth, so sign-out and session expiry are unaffected.

## [1.3.1] - 2026-06-26

### Fixed

- **Folder breadcrumb in collaboration galleries.** Nested sub-galleries in collaboration
  (voting) mode now show the full ancestor breadcrumb above the photo grid — the same
  `Parent › … › Current › child` trail presentation galleries already had. Previously the
  collaboration view only offered a one-level "up to parent" link, leaving clients in deeply
  nested galleries without orientation.
- **Notifications settings page no longer drifts sideways on mobile.**

## [1.3.0] - 2026-06-26

### Added

- **Full-instance backup & restore.** A new **Settings → Workspace** section builds a complete
  backup — the database plus uploads, branding, and watermarks — as a single archive you can
  download, and restores one back in place. Backups run as an async job (like ZIP export); restore
  is available both in the browser and via a CLI (`python -m app.restore <archive>`) for large
  instances. The database is captured with `VACUUM INTO` (never the live WAL), media is copied
  before the snapshot, a manifest records integrity and the schema revision, and restore refuses an
  archive from a *newer* build and keeps a rollback copy. Archives are plaintext — the UI warns, as
  they contain the password hash and secret key. See `docs/backup-and-restore.md`.
- **Photographer analytics.** A new **Analytics** dashboard (per-gallery in the Insights dialog and
  an instance-wide rollup at `/admin/analytics`) charts views, downloads, and engagement
  (flags, likes, ratings, votes, comments, annotations) over 7/30/90 days, with a "busiest
  galleries" / "top photos" breakdown. It's a pure read-model over existing activity — no new
  tracking. View counts appear only when activity IP logging is enabled; otherwise the dashboard
  says so rather than showing a fake zero. Timeseries bars use the instance accent colour.
- **Structured logging, request IDs & deep health checks.** Opt-in JSON logging (`LOG_FORMAT=json`),
  a per-request `X-Request-ID` correlation header, and an optional Sentry integration
  (`SENTRY_DSN`, PII-scrubbed, off unless set). Health is split into `GET /api/health` (liveness +
  version) and `GET /api/health/ready` (per-component database / migrations / storage / ML sidecar).
- **"Rebuild previews" maintenance action.** A button under Workspace regenerates all thumbnail and
  medium renditions from the originals — handy after a restore or a format-support change.
- **Optional `sqlite-vec` search backend.** For very large libraries (100k+ photos), an opt-in
  (`SEMANTIC_SEARCH_VEC`) C-accelerated vector index serves instance-wide semantic search; the
  default NumPy path and the SQLite source-of-truth table are unchanged. Off by default.

### Changed

- **Settings reorganized.** The settings navigation is regrouped into four coherent sections —
  Branding, Client Galleries, Workspace, and System — instead of one long list.
- **Smoother large galleries.** The admin and client photo grids are now window-virtualized, so
  galleries with thousands of photos scroll without the browser straining to render every tile.
- **Star-rating filter chips** were restyled to match the colour-flag chips — a gold star on a
  neutral chip rather than an amber fill.

### Fixed

- **UTC-aware API timestamps.** All model datetimes now round-trip as timezone-aware UTC, so the API
  serializes an explicit offset (`Z`). SQLite previously read them back naive, which some clients
  misparsed as local time.
- **Steadier toolbar.** The filter/sort/group bar no longer shifts when a filter becomes active, the
  admin search-mode layout is stable, and the "Filter & sort" count is floated so it can't shove the
  filter chips. The comment-filter active state is clearer, and flag/star chips are shown inline in
  the admin toolbar.
- **Insights label.** The per-gallery toolbar trigger now reads "Insights" instead of the misleading
  "Activity log" (the dialog holds both Analytics and Activity tabs).

### Upgrade notes

- **Host-mounted `nginx.conf` — manual step for backup/restore.** Backup/restore moves
  multi-gigabyte archives, which would otherwise hit nginx's 1 MB body cap and 413/truncate. The
  bundled `nginx.conf` now includes the block below; if you run a **custom or host-mounted** nginx
  config, add it yourself (above the general `location /api/`) — pulling the new images alone won't
  update a host-mounted file. Without it, backup download and restore upload will fail.

  ```nginx
  location ~ ^/api/admin/settings/(backup|restore) {
      client_max_body_size 2g;
      proxy_request_buffering off;
      proxy_pass http://backend:8000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 1800s;
      proxy_send_timeout 1800s;
  }
  ```

- **Database migration 0040** (`backup_jobs`) applies automatically on container start
  (`alembic upgrade head` runs in the entrypoint). No manual action needed.
- New optional env vars — `LOG_FORMAT`/`LOG_LEVEL`, `SENTRY_DSN`, `SEMANTIC_SEARCH_VEC` — are all
  off/default unless set; existing deployments are unchanged.

## [1.2.3] - 2026-06-25

### Added

- **Batch rename selected photos.** Select multiple photos, then "Rename selected…" opens a dialog
  with three modes — sequential numbering, find & replace, and prefix/suffix — with a live
  before → after preview. File extensions are always preserved, so downloads stay valid.
- **Customisable notification text.** Notification settings gain editable per-event message
  templates plus a title template (placeholders like `{author}`, `{count}`, `{gallery}`); leaving a
  field blank keeps the built-in default, so existing setups are unchanged.
- **Gallery link in notifications.** A new "Include gallery link" toggle (on by default) appends the
  public gallery URL to each notification — emitted only when a Public Base URL is configured.

### Changed

- **Clearer upload wording.** The sidebar "Upload New Files" / cover "Upload New Image" buttons and
  the drag-and-drop zone copy were reworded ("Add Files", "Add Image", "Add photos & videos").

### Fixed

- **Mobile gallery header.** The download button now stacks below the gallery title on narrow
  screens instead of crowding it.

## [1.2.2] - 2026-06-24

### Added

- **Bulk-delete selected photos.** The gallery selection bar gains a "Delete selected" action, so
  Select all → delete is possible.
- **Delete annotations without leaving annotation mode.** Tap an annotation (its number badge or the
  stroke) to reveal its trash button while the pen is still active.
- **Native settings list on mobile.** `/admin/settings` now shows a tappable section list instead of
  jumping straight into Branding (which hid every other section behind the drawer); each section page
  has a "← Settings" back arrow. Desktop is unchanged.

### Fixed

- **WhatsApp link previews.** The Open Graph image is now a bounded variant (≤ 1200 px) served from a
  new side-effect-free `GET /api/public/g/{token}/og-image` endpoint, instead of the raw header —
  a multi-MB header made WhatsApp (which has a strict image-size cap) drop the preview while Telegram,
  Apple Mail and Instagram showed it. Existing oversized headers are covered retroactively.
- **Header/cover uploads over 1 MB.** nginx capped these admin uploads at the 1 MB server default
  (only photo uploads were raised); lifted to 12 MB. Header/cover images are now also resized
  server-side to a bounded JPEG (≤ 3840 px) on upload, and the "set header from a gallery image" path
  never copies a full-size original.
- **Custom short link is now copy-pasteable.** Saving a custom slug refreshes the "Current link" row
  immediately, so the new link can be copied from there.
- **Mobile annotation.** The whole page no longer pinch/double-tap-zooms while annotating, and the
  stroke-width tools no longer push Download/Fullscreen/Close off the screen edge.
- **A video can no longer be set as the gallery header** (it has no Pillow-readable rendition).
- **Suppressed a benign dev-only CSP nonce hydration warning** on the theme script.

### Changed

- **Pinned the Turbopack workspace root to the repo root** (dev only). A stray lockfile above the
  repo made `next dev` infer the home directory as root and scan all of it — minutes-long route
  compiles and Node OOMs. Compiles drop back to ~15 ms.
- **Bounded the in-process og:image cache** (FIFO, 256 entries).

### Upgrade notes

- **The WhatsApp / og:image fix needs no nginx changes.** It ships in the backend image and is served
  through the existing `/api/` proxy, so a normal `docker compose pull` + `docker compose up -d` is
  enough for link previews to start working (existing oversized headers included).
- **The header/cover upload size fix requires updating the host-mounted `nginx.conf` *and* reloading
  nginx.** The file is bind-mounted from the host, so an image pull doesn't deliver it — copy the new
  `nginx.conf` next to your `docker-compose.yml`, then run **`docker compose restart nginx`**. Note
  that `docker compose up -d` alone does **not** reload it: Compose only recreates the nginx container
  when the service definition changes, not when the mounted file's contents change. Without the
  restart, header/cover uploads over 1 MB keep returning 413.

## [1.2.1] - 2026-06-24

### Security

- **Backend dependencies updated to clear known CVEs.** PyJWT 2.10.1 → 2.13.0, python-multipart
  0.0.18 → 0.0.31, Pillow 11.0.0 → 12.2.0, and FastAPI 0.115.6 → 0.138.0 (Starlette pinned to 1.3.1).
  `pip-audit` now reports zero known vulnerabilities across the backend. No behaviour change — image
  processing, EXIF extraction, authentication, uploads, watermarking, streaming ZIP downloads and the
  realtime WebSocket were all verified end-to-end against a freshly built stack.
- **Longer share-link tokens.** Newly created galleries now use 12-character share tokens (~62 bits of
  entropy) instead of 8, so an unlisted gallery URL can't be feasibly enumerated. **Existing share
  links are unaffected and keep working** — only generation changed.
- **Content-Security-Policy on the app.** The bundled nginx now sends a CSP header (alongside the
  existing X-Frame-Options / nosniff / Referrer-Policy), restricting the app to same-origin scripts,
  styles, images and connections (including the realtime WebSocket) and blocking framing — defense in
  depth against content injection.

### Added

- **Automated dependency scanning in CI.** A new workflow runs `pip-audit` (backend) and `npm audit`
  (frontend) on a weekly schedule and whenever a dependency manifest changes, so a CVE published
  against a pinned version surfaces without waiting for a code change.

### Fixed

- **Link previews now work out of the box on a standard deploy.** When `BACKEND_INTERNAL_URL` is
  unset, the frontend now defaults to the compose service name (`http://backend:8000`) in production
  instead of `localhost:8000` (which can never reach the backend from inside the frontend container).
  This silently broke link-preview unfurls for anyone who upgraded to 1.2.0 while keeping an older
  `docker-compose.yml`. **Upgrading from < 1.2.0:** if you maintain your own `docker-compose.yml`,
  either pull the latest one or add `BACKEND_INTERNAL_URL: "http://backend:8000"` to the `frontend`
  service's `environment:` (only needed if your backend service is named something other than
  `backend`).

## [1.2.0] - 2026-06-23

### Added

- **Star ratings as an alternative to color flags.** A new instance-wide **Rating style** setting
  (Settings → Gallery Defaults) switches every gallery between color flags and classic **1–5 stars** —
  one or the other, never both. Stars work everywhere flags did: the grid tiles, the lightbox, the
  filter/group/sort toolbar, and per-reviewer team voting. Switching is **non-destructive** — flags and
  stars are stored separately and neither is converted or cleared, so you can flip back and forth without
  losing any review work.
- **Link previews for shared galleries (Open Graph).** Pasting a gallery share link into iMessage,
  WhatsApp, Slack, Discord, and the like now unfurls a rich preview with the gallery's name and cover
  image (Open Graph + Twitter summary card). Password-protected galleries reveal the name but never the
  cover. The preview is built from a dedicated, side-effect-free metadata endpoint, so a link-scraper
  unfurl never counts as a client view or fires a notification.
- **Instant gallery downloads — no "preparing ZIP" wait.** "Download all" and filtered selections now
  stream the ZIP on the fly, with a real browser progress bar and no server-side prepare/poll step —
  the archive starts downloading immediately and its size is known up front.
- **Title position over the header image.** Presentation galleries can now anchor the gallery title to
  any of nine positions over the full-screen hero (top-left … bottom-right) via a 3×3 picker in the
  gallery's Look settings. Defaults to centered, exactly as before.
- **Download filename lists as a file (.txt / .csv) for Lightroom & co.** The "Copy filenames" dialog
  now offers a **Download** button alongside Copy: a plain `.txt` list (paste into Lightroom's Filename
  filter, Capture One, Photo Mechanic) or a `.csv` review sheet with one row per photo
  (`filename, rating, flag, likes, comments`) that opens in Excel/Sheets. Files are named after the
  gallery; the CSV carries a UTF-8 BOM so umlauts render correctly.
- **Include subgalleries when exporting filenames.** A new toggle in the same dialog folds in every
  photo from nested galleries (recursively), with the current filters applied across the whole tree —
  so "all selects" can span an entire gallery subtree in one export. Suppressed for collection and
  search views, which are per-gallery.

### Changed

- **Faster ZIP downloads.** Original photos are now stored uncompressed (`ZIP_STORED`) in the archive
  instead of DEFLATE — they're already-compressed JPEG/RAW/video, so compressing them again only burned
  CPU. Downloads start sooner and carry an exact `Content-Length`.

### Fixed

- **Annotations are drawable again in the lightbox.** The photo was painting on top of the annotation
  layer, so freehand drawing did nothing (the drag toggled immersive mode instead) and saved marks
  couldn't be clicked. The layer now sits above the photo and receives pointer events.
- **Color flag set in the lightbox now shows on the thumbnail immediately.** Flagging a photo in the
  lightbox and closing it left the grid thumbnail showing the old flag until a page refresh; the tile
  now adopts the change live (also fixes the same lag for flags set by another reviewer).

## [1.1.4] - 2026-06-22

### Fixed

- **Content Search status now tells "reachable" apart from "model loaded."** The ML-service badge
  read "online" whenever the sidecar answered its health check — even when the model failed to load
  and every image was failing to index. It now shows **"reachable, model not loaded"** with a hint
  (check the sidecar logs; often an unwritable model-cache dir) when the service is up but indexing
  is erroring, so this case diagnoses itself.
- **Lightbox: images keep a consistent bottom margin in showcase mode.** With the caption/filename
  off, the photo ran to the bottom edge; the footer row is now always reserved so the image has the
  same bottom margin whether or not a caption is shown.

## [1.1.3] - 2026-06-22

### Added

- **Infinite scroll on the All Photos view.** Scrolling near the end now loads the next page
  automatically; the "Load more" button stays as a fallback.

### Fixed

- **Content search: self-healing model-cache permissions.** When `data/ml-cache` was created as root
  (a common Docker bind-mount default), the ML sidecar (UID 1001) couldn't download the model, so
  **every** image failed to index while the service still showed "online". The sidecar now fixes the
  cache ownership on startup and drops privileges — mirroring how the backend already heals `/data`.
  Affected operators just `docker compose pull && docker compose up -d`.
- **Client (visitor) uploads were capped at 1 MB by the bundled nginx**, returning 413 for any real
  photo. The public upload path now shares the same large body-size limit as the admin upload.

### Deployment / upgrade notes

- If you run an **extra reverse proxy in front of the bundled nginx** (e.g. an HTTPS terminator),
  set `TRUSTED_PROXY_HOPS=2` in `.env` so rate limiting and the activity log record the real client
  IP instead of the proxy's. Default `1` covers the bundled nginx only.

## [1.1.2] - 2026-06-22

### Added

- **Photoshop PSB support.** Upload `.psb` (large-document) files. When the file carries an embedded
  preview (saved with *Maximize Compatibility*) it shows a normal thumbnail; otherwise it appears as
  a download-only tile and the original downloads intact. No heavy decoder — the preview is read
  straight from the file's embedded thumbnail, so it stays fast even on multi-GB files.

### Fixed

- The upload drop-zone hint still read "JPEG, PNG, WebP up to 200 MB" — it now lists the formats and
  limit added in 1.1.1 (TIFF, PSD, PSB & RAW, up to 300 MB).

### Notes & limitations

- PSB previews depend on the embedded thumbnail (small if Photoshop saved a small one), and PSB is
  excluded from content search. Very large PSB still respect the upload size limit (`MAX_UPLOAD_BYTES`).

## [1.1.1] - 2026-06-22

### Added

- **Broad file-format support.** Upload **TIFF, PSD, and camera RAW** (CR2, CR3, NEF, ARW, RAF, ORF,
  RW2, DNG, and more) alongside JPEG/PNG/WebP. Your original files are stored and downloaded
  untouched; the gallery, lightbox, and ZIP exports use generated JPEG previews. Content search
  indexes the new formats too.

### Fixed

- **Notifications: the "Add channel" button did nothing** when the admin was served over plain HTTP
  (a LAN IP or an HTTP-only reverse proxy). It depended on a browser API (`crypto.randomUUID`) that
  exists only on HTTPS/localhost; it now works on insecure origins.
- **Copying a share link and copying filenames** silently failed over plain HTTP for the same reason
  (`navigator.clipboard`); both now fall back so they work without HTTPS.

### Notes & limitations

- **RAW previews use the camera's embedded JPEG** (no demosaic — this keeps the app lean and fast).
  Modern cameras embed a full-resolution preview; some older compacts embed only a small one,
  yielding a lower-res preview. The original RAW always downloads intact.
- **PSD** renders its flattened composite (save with *Maximize Compatibility*); layers aren't read.
  **PSB** (large-document) isn't supported yet. **Video is still never transcoded** (unchanged).
- Default per-file upload limit raised from 200 MB to **300 MB** (configurable via `MAX_UPLOAD_BYTES`).

### Deployment / upgrade notes

- **Nothing to do — no new services and no database migration.** The backend image gains one small,
  self-contained RAW-preview dependency (`rawpy`); just `docker compose pull && docker compose up -d`.

## [1.1.0] - 2026-06-22

### Added

- **Content search (optional).** Find photos by what's *in* them ("car at sunset", "team photo with
  trophy") — within a gallery, or across the whole library from the new **All Photos** view. It runs
  on an on-device, multilingual AI model (SigLIP 2); nothing leaves your server. Enable it under
  **Settings → Content Search**, with an accuracy slider and a live index-progress readout.
- **All Photos** — a cross-gallery photo browser on the overview (a tab next to *Galleries*), sorted
  by date or name, paginated. Its search box runs semantic search when content search is on, and
  otherwise filters by **filename, gallery name, and IPTC metadata** (keywords, caption, title,
  location, creator) — so it's useful even without the AI model. Results badge their gallery and
  deep-link straight into its lightbox.

### Deployment / upgrade notes

- **Nothing changes for an existing deployment unless you opt in.** The semantic-search model runs
  in a **separate, optional `ml` sidecar** that the default stack never starts. A new migration
  (`0037`) applies automatically on upgrade and is inert until the feature is enabled.
- To turn it on: `docker compose --profile ml up -d` and set `ML_SERVICE_URL=http://ml:8001` in
  `.env`, then enable it under Settings → Content Search. The model (~a few hundred MB) downloads
  once into the data volume on first use.
- The sidecar is CPU-only (no GPU needed) and intended to stay light, but it does add load — on a
  low-power host you can simply leave it off. When it isn't deployed, Settings → Content Search
  detects this and explains how to start it instead of offering a toggle that can't work.

## [1.0.6] - 2026-06-21

### Added

- **Move gallery** — relocate a whole gallery, with its sub-galleries, to another parent or to the
  top level. A picker in the gallery's menu (⋯ → Move gallery) mirrors the move-images dialog, marks
  the current parent, and excludes the gallery's own subtree to prevent cycles.

### Changed

- The admin gallery detail page now adapts to what's inside: a **container** (sub-galleries, no own
  photos) leads with its sub-galleries and lets the photo tools recede, instead of opening to an
  empty grid; leaf and mixed galleries stay photo-first.
- Reorganising galleries by drag is **always on** — the "Organize" toggle is gone. Drag a gallery
  onto another to nest it, or onto the permanent "move to top level" strip above the grid to pull it
  out. A reparent shows an Undo. Drag is disabled on touch (where the Move gallery dialog is the
  reliable path).

## [1.0.5] - 2026-06-20

### Changed

- The mobile filter/sort/group toolbar in the review and admin gallery views no longer occupies
  three sticky rows. It now stays a single row — filename search plus a **Filter & sort** button
  that opens a bottom sheet holding the flag/comment filters, sort and grouping.
- On a phone, the admin gallery detail page merges the "go up" link into the top bar (in place of
  the global brand) instead of stacking a second navigation row below it.
- The header/cover image buttons on the admin gallery page now appear only for an empty gallery;
  once it has photos, those actions live in the sidebar menu so the canvas opens straight to the
  grid.

### Fixed

- On touch devices the per-photo collaboration controls (flag picker, like, download, comment) were
  rendered permanently over every thumbnail (no hover to reveal them), obscuring the photo. The grid
  now shows only resting indicators — the active flag dot and comment badge — and flagging or
  commenting happens in the lightbox.

## [1.0.4] - 2026-06-18

### Changed

- Loading states across the admin settings pages and the gallery detail view now show skeleton
  placeholders instead of a bare "loading…" line, so the layout no longer jumps when content
  arrives.
- The empty filter result now offers a **clear filters** action.

### Fixed

- Accessibility: visible focus rings on controls that previously showed none (footer settings
  inputs, the public footer's social links, the annotation editor), `aria-label`s on icon-only
  buttons, and the OS "reduce motion" preference is now honored everywhere (lightbox swipe, drawers,
  dialogs, spinners).
- The public footer's social links now meet the 44px touch-target size and respond to tap/focus
  rather than hover-only.
- Lifted low-contrast muted text in the public gallery and admin to clear WCAG AA.
- The photo grid no longer reflows as lazy-loaded images arrive in list view — each tile reserves
  its height up front.

## [1.0.3] - 2026-06-18

### Fixed

- **Delete** and **Rename** in the gallery overview's card menu navigated into the gallery instead
  of opening their dialog. The menu is portalled in the DOM but still a React child of the card, so
  item clicks bubbled up the React tree to the card's open handler; they're now stopped at the menu.

## [1.0.2] - 2026-06-18

### Added

- Sub-galleries can be created directly in **Showcase** or **Review** mode — the create dialog now
  has a mode selector, pre-filled with the parent gallery's mode.
- Selected photos can be moved into another gallery in bulk: a **Move to gallery** action in the
  selection bar, plus drag-and-drop of the whole selection onto sidebar galleries and sub-gallery
  cards (with an undoable confirmation).

### Changed

- The **Capture Date** sort option now appears only when at least one photo in the gallery carries
  EXIF capture metadata; without it the sort falls back to filename so the order stays meaningful.

### Fixed

- A Showcase sub-gallery of a Review gallery was stuck in the review (sidebar) layout regardless of
  its own mode. Sub-galleries now follow their own mode.
- Public gallery dialogs (save collection, reviewer name, client upload, download) used a fixed
  dark or light surface instead of following the gallery's tone — they now adapt to the bright/dark
  setting. The download dialog, which is shared with the admin, also tracks the admin theme.

## [1.0.1] - 2026-06-18

### Added

- The login screen now shows the instance's branding logo, falling back to the ContactSheet
  default mark.

### Fixed

- Copy filenames, the flagged-selection text export, and ZIP downloads no longer leak the folder
  path for photos added via a folder (drag-and-drop) upload. Uploads now store only the base
  filename, and the existing consumers strip any leftover path from older rows.
- Dragging a photo while a non-manual sort (by date, name, etc.) was active could silently move it
  out into the parent gallery. Reparenting now only happens on a deliberate drop onto a gallery
  card or nav folder; an image dropped in empty space simply stays put.

### Changed

- The default source-code URL (the AGPL §13 "source" link) now points at the public GitHub
  repository.
- Neutral, professional example text across admin UI placeholders and the documentation.

### Demo & documentation

- Added a reproducible demo instance (seed scripts + asset manifest) and refreshed all
  documentation screenshots.
- Demo photos now use Lorem Picsum imagery, and the showcase demo gallery gained a full-width
  hero banner.

## [1.0.0] - 2026-06-17

Initial public release. ContactSheet is a self-hosted photo delivery platform for photographers —
share private client galleries, collect feedback, and deliver finals. The REST API and share-link
contract are considered stable as of this release.

### Galleries & delivery

- Nested galleries (unlimited depth) with shareable links and two modes: **Showcase**
  (presentation) and **Review** (collaboration).
- Customizable share slugs, optional per-gallery passwords, and expiry dates.
- Per-gallery look & behaviour — layout, preview size/spacing/corners, opener typography,
  backgrounds — with instance-wide mode presets and autosaving settings.

### Client collaboration

- Color flags, per-person likes, comments, and team voting.
- Freehand **annotations** anchored to a photo (each is a comment with a spatial mark).
- Saved **collections** (named image sets), editable by their creator or the admin.
- **Client uploads** with an optional approval/moderation queue.

### Media

- Image upload and processing (thumb/small/medium renditions; EXIF + IPTC extraction).
- Browser-native **video** (MP4/MOV/WebM) served as-is, no transcoding.
- Image and text **watermarks**, composited on the fly and cached.
- **ZIP export** — whole gallery, a filtered selection, or multiple galleries — as background jobs.

### Branding & experience

- Instance and gallery **branding**: studio name, logo, accent color, masthead fonts, public footer.
- Installable **PWA** with a branding-aware app icon.
- **Internationalization** (English + German), Weblate-backed.
- Mobile-responsive admin and client surfaces; a touch lightbox with swipe gestures.
- **Real-time updates** over WebSocket.

### Notifications

- Pluggable channels via **Apprise** (email, Pushover, Discord, ntfy, Telegram, Slack, custom),
  with an outbox + coalescing flusher and an opt-in SSRF guard.

### Security & operations

- Stateless admin JWT (httponly, `SameSite=strict`, auto-`Secure` over HTTPS), "sign out
  everywhere", a first-run setup wizard, and a guarded factory reset.
- Per-IP rate limiting on auth and every public write, derived from a configurable number of
  trusted proxy hops (`TRUSTED_PROXY_HOPS`).
- Path-traversal-safe storage, magic-byte upload validation, and decompression-bomb / pixel-area
  caps (stricter for public uploads).
- Docker Compose deployment (backend + frontend + nginx); SQLite + local filesystem.

[Unreleased]: https://github.com/nielsfranke/contactsheet/compare/v1.11.0...HEAD
[1.11.0]: https://github.com/nielsfranke/contactsheet/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/nielsfranke/contactsheet/compare/v1.9.4...v1.10.0
[1.9.4]: https://github.com/nielsfranke/contactsheet/compare/v1.9.3...v1.9.4
[1.9.3]: https://github.com/nielsfranke/contactsheet/compare/v1.9.2...v1.9.3
[1.9.2]: https://github.com/nielsfranke/contactsheet/compare/v1.9.1...v1.9.2
[1.9.1]: https://github.com/nielsfranke/contactsheet/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/nielsfranke/contactsheet/compare/v1.8.1...v1.9.0
[1.8.1]: https://github.com/nielsfranke/contactsheet/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/nielsfranke/contactsheet/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/nielsfranke/contactsheet/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/nielsfranke/contactsheet/compare/v1.6.9...v1.7.0
[1.6.9]: https://github.com/nielsfranke/contactsheet/compare/v1.6.8...v1.6.9
[1.6.8]: https://github.com/nielsfranke/contactsheet/compare/v1.6.7...v1.6.8
[1.6.7]: https://github.com/nielsfranke/contactsheet/compare/v1.6.6...v1.6.7
[1.6.6]: https://github.com/nielsfranke/contactsheet/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/nielsfranke/contactsheet/compare/v1.6.1...v1.6.5
[1.6.1]: https://github.com/nielsfranke/contactsheet/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/nielsfranke/contactsheet/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/nielsfranke/contactsheet/compare/v1.4.3...v1.5.0
[1.4.3]: https://github.com/nielsfranke/contactsheet/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/nielsfranke/contactsheet/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/nielsfranke/contactsheet/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/nielsfranke/contactsheet/compare/v1.3.5...v1.4.0
[1.3.5]: https://github.com/nielsfranke/contactsheet/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/nielsfranke/contactsheet/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/nielsfranke/contactsheet/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/nielsfranke/contactsheet/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/nielsfranke/contactsheet/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/nielsfranke/contactsheet/compare/v1.2.3...v1.3.0
[1.2.3]: https://github.com/nielsfranke/contactsheet/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/nielsfranke/contactsheet/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/nielsfranke/contactsheet/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/nielsfranke/contactsheet/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/nielsfranke/contactsheet/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/nielsfranke/contactsheet/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/nielsfranke/contactsheet/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/nielsfranke/contactsheet/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/nielsfranke/contactsheet/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/nielsfranke/contactsheet/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/nielsfranke/contactsheet/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/nielsfranke/contactsheet/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/nielsfranke/contactsheet/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/nielsfranke/contactsheet/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/nielsfranke/contactsheet/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nielsfranke/contactsheet/releases/tag/v1.0.0
