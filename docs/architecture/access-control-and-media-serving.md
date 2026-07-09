# Access control & media serving

Status: **implemented** — security model consolidated 2026-06-17 (upload-pipeline / ZIP / public
endpoint review).

The gallery access model and where its boundaries are. Read this before changing anything in
`routers/public.py`, `services/image_service.py`, `tasks/image_processing.py`, or the `/uploads`
nginx block.

## Per-gallery gating (each gallery stands alone)

Every gallery is independently reached by its own `share_token` (`/g/{token}`) and optionally
guarded by its own password. **Passwords do not cascade to sub-galleries** — a password on a parent
does *not* lock its children, and each child is reachable directly via its own token.

This is intentional, not a bug: tokens are per-gallery capabilities and the standalone-access
feature (`hide_parent_nav`) explicitly supports sharing one sub-gallery without exposing the parent.
The consequence to be aware of:

- **Default is safe** — a freshly created gallery gets a random UUIDv4 `share_token` (unguessable),
  so an unprotected child under a protected parent is still only reachable by someone who already
  knows the child's token (which is only handed out in the parent's `subgalleries[]` nav, i.e. to
  someone who already passed the parent gate).
- **The risk is operator-introduced** — giving a child a *guessable custom slug* and no password
  makes it independently discoverable. `ShareDialog` already warns when a slug is non-UUID and the
  gallery has no password. Guidance: protect sub-galleries individually if they're sensitive; don't
  assume a parent password covers them.

We deliberately did **not** add password inheritance: it would break standalone sub-gallery sharing
and is a product decision, not a security fix. Documented, not gated.

## Media serving (the `/uploads` boundary)

Renditions and originals live under `/data/uploads/{gallery_id}/{variant}/{stored_filename}` and are
served **ungated** by nginx (and `StaticFiles` in dev) — never through Python — for performance.
Protection rests on `gallery_id` + `stored_filename` being unguessable UUIDv4s. Implications:

- **Capability URLs** — a media URL works for anyone who holds it, with no per-request password /
  expiry / token check. A leaked URL outlives the gallery's expiry and bypasses its password. This
  is the accepted trade-off of ungated static serving.
- **`downloads_enabled` and watermarking must not leak the `stored_filename`** — otherwise a viewer
  could derive the sibling `…/original/{stored_filename}` path and pull the full-res, un-watermarked
  original. So `_image_to_response` routes thumb/small/medium through the access-checked Python proxy
  (`/api/public/g/{token}/images/{id}/{variant}`, which serves by `image.id`, never the stored name)
  whenever the gallery is **watermarked OR has downloads disabled** (`proxy_variants`). Watermarked
  *and* downloads-enabled non-watermarked galleries with the original intentionally public keep the
  fast direct static URLs.
- **Video originals are always exposed** (`video_url`) — video can't be watermarked and the original
  *is* the only playable file. A downloads-disabled gallery therefore can't hide video originals;
  this is inherent to the no-transcode design.

## Upload pipeline hardening

- **Decompression-bomb / giant-dimension guard** — `process_image` rejects on the header-declared
  pixel area (`settings.max_image_pixels`, default **250 MP**, env `MAX_IMAGE_PIXELS`) *before*
  allocating any bitmap, and `Image.MAX_IMAGE_PIXELS` is pinned as a second layer. Over-limit files
  end `processing_status = error`, never an OOM. The **attacker-reachable client-upload path keeps a
  far stricter 50 MP cap** (`client_upload_max_pixels`) — the admin ceiling was raised to 250 MP so
  high-end medium format (Phase One 150 MP, GFX 100) and panorama stitches process instead of
  failing rendition.
- **MIME / magic / naming** — stored name is always a server `{uuid}{ext}` derived from the
  *declared* MIME, magic bytes are checked against that MIME, renditions are re-encoded by Pillow,
  and files are served with extension-derived content-type + `X-Content-Type-Options: nosniff`. A
  polyglot is stored inert and served as an image; the user's filename never reaches a path.
- **Client-upload disk caps** — public uploads are capped tighter than admin: per-file
  `client_upload_max_file_bytes` (25 MB) and per-request `client_upload_max_total_bytes` (250 MB),
  both aborting mid-stream, on top of the 50-file count cap and the `10/minute` rate limit.

## Moderation

When `client_upload_moderation` is on, pending uploads are invisible to the public. This is enforced
on **both** the listing (`only_approved`) *and* every per-image public endpoint (variant serving,
comments, flag, like, vote, comment-add) — a pending image returns 404 publicly even if its id is
known. Admin paths (`routers/galleries.py`, `routers/images.py`) are unaffected and still show
pending uploads.
