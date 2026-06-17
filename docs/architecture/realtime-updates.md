# Real-time updates (WebSocket) — Phase 3 Feature 9

Status: implemented (2026-06-15)

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
- `rooms: dict[str, set[WebSocket]]` keyed by `gallery_id`.
- `async connect / disconnect / broadcast(gallery_id, message)` — broadcast iterates the room,
  sends JSON, prunes dead sockets.
- Captures the running event loop at lifespan startup so sync request code can publish onto it.

### Sync→async bridge — `realtime.publish(gallery_id, message)`
A **sync** function callable from the existing sync service/route code. It marshals the broadcast
onto the captured loop via `asyncio.run_coroutine_threadsafe` (sync routes run in Starlette's
threadpool). Never raises into the request — mirrors `notification_service.enqueue`'s defensiveness.
No-op if the hub/loop isn't up (e.g. tests).

### WebSocket endpoints — `app/routers/realtime.py`
Both resolve to the same `gallery_id` room:
- **Admin**: `WS /api/ws/admin/galleries/{gallery_id}` — auth via the **httponly `access_token`
  cookie** (the WS handshake is same-origin and carries cookies; validated exactly like
  `get_current_admin`, including `token_version`). No token in the URL.
- **Public**: `WS /api/ws/public/g/{share_token}` — resolve the gallery by share token; if it has a
  password, require `?token=<galleryJWT>` whose `gallery_id` matches (gallery tokens live in
  `sessionStorage` as bearers, so they must ride the query string — see trade-offs); password-less
  galleries need no token.

On accept → `hub.connect`; on disconnect/error → `hub.disconnect`. The server ignores inbound
frames (keepalive only).

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

The upload signal fires when background processing completes, so new admin **and client** uploads
appear live. Admin-side photo edits (move/delete/reorder) also publish `image` so an open client
view stays consistent.

## Frontend

### Client — `src/lib/realtime.ts`
One reconnecting WebSocket per gallery (ref-counted across hook users). Builds the URL from the
public base URL / `window.location` (`ws`↔`wss`), exposes `subscribe(onEvent)`, and reconnects with
capped backoff + a heartbeat. Closes when the last subscriber unmounts.

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
- Follow-ups: presence/typing indicators, bidirectional actions over the socket, collapsing rapid
  bursts client-side.
