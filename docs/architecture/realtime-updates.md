# Real-time updates (WebSocket) — Phase 3 Feature 9

Status: implemented (2026-06-15); instance-wide admin room added 2026-09-07

The last unfinished Phase 3 feature. Today the gallery learns about changes only by
poll-and-invalidate: the admin detail page polls `gallery-images` **only while an upload is
processing** (3 s), and the public viewer doesn't poll at all — it refetches only on the *same
client's* own mutations. So a comment, flag, vote, collection, or client upload from one viewer is
invisible to everyone else until a manual refresh. This adds a live push so open galleries update
themselves.

## Core decision — thin "invalidate" signals, not data payloads

The socket carries **lightweight event signals**, not serialized resources:

```json
{ "type": "comment", "gallery_id": "…", "image_id": "…" }
```

The client maps the signal to the React Query keys it already owns and **invalidates** them; the
existing REST refetch then re-applies every access rule (gallery password, watermark proxy, admin
vs public serialization). This reuses the whole existing query/serialization/auth stack, can't leak
data the recipient shouldn't see, and keeps messages tiny. We are **not** building a parallel
payload pipeline.

The connection is **server → client only** initially (clients still mutate via REST). WebSocket is
the named roadmap feature and leaves room for future bidirectional use (presence/typing); it sends
no application data upstream.

## Backend

### Connection hub — `app/realtime/hub.py`
A process-singleton `ConnectionHub`:
- `rooms: dict[str, set[WebSocket]]` keyed by `gallery_id`, plus one reserved instance-wide room
  `ADMIN_ROOM = "admin"` (a bare word can't collide with a UUIDv4 key) — see *Admin-wide room*.
- `async connect / disconnect / broadcast(gallery_id, message)` — broadcast iterates the room,
  sends JSON, prunes dead sockets.
- Captures the running event loop at lifespan startup so sync request code can publish onto it.

### Sync→async bridge — `realtime.publish(gallery_id, type, …)` / `publish_admin(type, gallery_id, …)`
**Sync** functions callable from the existing sync service/route code. They marshal the broadcast
onto the captured loop via `asyncio.run_coroutine_threadsafe` (sync routes run in Starlette's
threadpool). Never raise into the request — mirrors `notification_service.enqueue`'s defensiveness.
No-op if the hub/loop isn't up (e.g. tests). `publish` targets a gallery's room (admin + public
viewers of that gallery); `publish_admin` targets `ADMIN_ROOM` only — public viewers never see it.

### WebSocket endpoints — `app/routers/realtime.py`
Both resolve to the same `gallery_id` room:
- **Admin**: `WS /api/ws/admin/galleries/{gallery_id}` — auth via the **httponly `access_token`
  cookie** (the WS handshake is same-origin and carries cookies; validated exactly like
  `get_current_admin`, including `token_version`). No token in the URL.
- **Public**: `WS /api/ws/public/g/{share_token}` — resolve the gallery by share token; if it has a
  password, require `?token=<galleryJWT>` whose `gallery_id` matches (gallery tokens live in
  `sessionStorage` as bearers, so they must ride the query string — see trade-offs); password-less
  galleries need no token.

- **Admin-wide**: `WS /api/ws/admin` — same cookie auth as the per-gallery admin socket (shared
  `_accept_admin` helper: accept, `_cross_origin` check, `decode_token` + `_is_valid_admin`
  incl. `token_version`, close 4401 on failure), subscribes to `ADMIN_ROOM`.

On accept → `hub.connect`; on disconnect/error → `hub.disconnect`. The server ignores inbound
frames (keepalive only).

### Admin-wide room — why a second kind of room
Per-gallery rooms can't carry changes to the gallery *list*: a freshly **created** gallery has no
room anyone could already be watching, and the overview / nav tree watch no particular gallery.
Before this room existed, galleries and sub-galleries created by an API-token client (Lightroom
plug-in, a desktop uploader) never appeared in an open admin tab until a manual refresh — creating
in the web UI only *looked* instant because `CreateGalleryDialog` invalidates `["galleries"]`
locally. Retrying "because it didn't work" then produced real duplicates.

`gallery_service` (and `image_service.use_image_as_header`, which writes a gallery column) emit
`publish_admin("gallery", gallery_id)` — **service layer, never route handlers** — on: create
(`derive` goes through create), update (only when something changed), move, share-token change,
delete, empty (soft-deletes the subtree), cover/header upload + removal. Per-image signals keep
going to the per-gallery room only (`tasks/image_processing.py` is untouched).

### Lifespan
Capture the loop + build the hub in `_lifespan` (next to the notification flusher). Sockets close on
shutdown. Register the router in `main.py`.

### Emit sites (sync, alongside the existing `activity_repo.log` / `notification_service.enqueue`)
| Action | Source | Signal `type` | extra |
|---|---|---|---|
| Comment add/edit/delete | `comment_service` | `comment` / `annotation` | `image_id` |
| Color flag | `image_service.public_set_flag` + admin flag | `flag` | `image_id` |
| Like | `image_service.public_increment_like` | `flag` | `image_id` |
| Team vote | public vote route | `vote` | `image_id` |
| Collection save/delete | `collection_service` | `collection` | — |
| Upload finished | `tasks/image_processing.process_image` (on done) | `image` | — |
| Gallery create / update / move / share-token / delete / empty / cover / header | `gallery_service` (+ `image_service.use_image_as_header`) | `gallery` → **`ADMIN_ROOM`** | — |

The upload signal fires when background processing completes, so new admin **and client** uploads
appear live. Admin-side photo edits (move/delete/reorder) also publish `image` so an open client
view stays consistent.

## Frontend

### Client — `src/lib/realtime.ts`
One reconnecting WebSocket per gallery (ref-counted across hook users). Builds the URL from the
public base URL / `window.location` (`ws`↔`wss`), exposes `subscribe(onEvent)`, and reconnects with
capped backoff + a heartbeat. Closes when the last subscriber unmounts.

### Coalescing — `src/lib/realtime-invalidate.ts`
`createCoalescedInvalidator(flush, 400 ms)` collects the distinct query keys touched within a
window and flushes them once — a bulk upload emits one signal per image, and refetching per
signal hammered the DB pool (`docs/architecture/db-connection-pool-under-bulk-upload.md`). Pure
(no React), shared by both hooks below, unit-tested in vitest.

### Hook — `src/hooks/useAdminRealtime.ts`
`useAdminRealtime(enabled)` opens `WS /api/ws/admin` **once in the admin shell**
(`app/admin/layout.tsx`, gated on the shell's auth check so it never races a 4401) and maps
`gallery` → `["galleries"]` + `["gallery", id]`. The tree feeds the overview, the sidebar
`GalleryTree`, and a detail page's sub-gallery block + breadcrumb (`findChildren` / `findParent`
over `["galleries"]`), so a sub-gallery created underneath an open detail page appears live.

### Hook — `src/hooks/useGalleryRealtime.ts`
`useGalleryRealtime({ shareToken | adminGalleryId, galleryToken, queryClient })` opens the right
endpoint and maps signals → invalidations:
- `comment`/`annotation` → comment query keys + the images key (counts/badges).
- `flag`/`vote` → images key (+ `["public-votes", …]` on vote).
- `collection` → collections key.
- `image` → images key.

Wired in **`useGalleryView`** (public: invalidates `["public-images", shareToken, galleryToken]`,
`["public-collections", …]`, `["public-votes", …]`) and **`useGalleryDetail`** (admin:
`["gallery-images", id]`, `["collections", id]`, comment keys). The admin upload-processing poll
stays as a cheap local fallback; everything else becomes event-driven.

## Deployment — `nginx.conf`
Add a dedicated `location ^~ /api/ws/` with `proxy_http_version 1.1`, `Upgrade`/`Connection
"upgrade"` headers, `proxy_buffering off`, and a long `proxy_read_timeout` (e.g. 3600s). (The
existing `/api/` block has 120 s timeouts and no upgrade headers.) Reverse proxies in front of the
stack must also forward WebSocket upgrades.

## Trade-offs & non-goals
- **Single process — by design, not a limitation to fix.** The in-process hub lives in one uvicorn
  worker, the same deliberate choice `backend/start.sh` documents for the rate limiter, notification
  flusher, and BackgroundTasks. This is right for a self-hosted single-photographer app: one async
  worker handles far more concurrent sockets/requests than realistic galleries produce, and it keeps
  the stack dependency-light (no Redis to run/secure/back up). **Multi-worker fan-out is explicitly
  not a goal** — `publish()` is the single choke point, so a Redis-backed hub could be slotted in
  later if a real multi-replica need ever appears, but it would be part of a full multi-worker effort
  (rate limiter + flusher too), not a standalone change.
- **Public token in the query string.** Browser `WebSocket` can't set an `Authorization` header, so
  password-gated public galleries pass the short-lived gallery JWT as `?token=`. The signal carries
  no sensitive data, tokens are short-lived, and we can drop query logging for the ws path. Admin
  uses the cookie, so no token leaks there.
- **No DB changes / no migration.** Pure transport. Independent of the notifications outbox (that
  delivers to the photographer out-of-band; this drives live UI).
- **Best-effort delivery.** A missed frame just means a viewer is briefly stale until their next
  action or reconnect (which invalidates). No replay/queue per socket.
- **Per-image signals don't reach the admin-wide room.** The overview card's `image_count` /
  auto cover for an *out-of-band* upload into an existing gallery still refreshes only via the
  30 s `staleTime` + window-focus refetch (or the `gallery` signal that a create emits). Mirroring
  `image` into `ADMIN_ROOM` would be a one-liner in `_publish_to`, but it would make every admin
  tab refetch the full tree ~2×/s for the whole duration of a bulk upload — deliberately not done
  until the tree endpoint is cheaper.
- Follow-ups: presence/typing indicators, bidirectional actions over the socket.
