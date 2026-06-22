# Streaming ZIP downloads — kill the "preparing" wait

Status: **proposed** (2026-06-22). Follow-up to the STORED-compression quick win (already shipped —
see below). Triggered by photographer feedback: "Download All Files" on a gallery with sub-galleries
(~525 originals across 4 sub-galleries) sits in **Preparing…** for a long time before anything
downloads — painful on a low-end server.

## What already shipped (the prerequisite)

`zip_task.py` now zips with **`ZIP_STORED`** (constant `_ZIP_COMPRESSION`), not `ZIP_DEFLATED`.
Originals are already-compressed (JPEG / camera RAW / MP4-MOV), so DEFLATE burned CPU for ~0% size
gain — the dominant cost of a large build and brutal on weak CPUs. STORED copies bytes → the build
is disk-I/O bound, much faster. This doc builds on it: STORED's **predictable, data-independent
size** is exactly what makes a streamed download able to advertise a real `Content-Length`.

## The remaining problem

The flow is still **build-then-download**: `POST …/zip` creates a `ZipJob`, a `BackgroundTask`
writes the *entire* archive to a temp file under `exports_dir`, the client **polls** `GET
…/zip/{job}` every ~1.5 s (`useGalleryZip`), and only once it flips to `ready` does the browser
fetch the file. So the user waits the full build wall-clock in a **spinner with no progress**, a
multi-GB temp file is written to disk (a real constraint on small VPS disks), and it's then read
back to serve. Two passes over the data, one indeterminate wait.

## Goal

- **No "Preparing" step.** The download starts within a second of the click.
- **Real progress + ETA** in the browser's native download UI (needs `Content-Length`).
- **No temp file**, low constant memory — friendly to low-end servers and small disks.
- Keep filename de-duplication, sub-gallery folder structure, and access control identical.

## Design

### Single streaming GET, no job, no poll

Replace the create→poll→download dance (for the common "download all / selection" case) with **one
`GET` the browser navigates to**, which returns a `StreamingResponse` that generates the ZIP on the
fly:

```
GET /api/public/g/{share_token}/zip/stream?subs=<tok>,<tok>&token=<gallery_jwt>
GET /api/public/g/{share_token}/zip/stream?images=<id>,<id>&token=<gallery_jwt>
```

The handler: resolve gallery → access check → assemble the member list (same logic as
`build_zip_multi` / `build_zip_for_images`) → return `StreamingResponse(zip_iter, media_type=
"application/zip", headers={Content-Disposition, Content-Length})`.

### Library

Use **`zipstream-ng`** (pure-Python, maintained, zip64-aware). It yields the archive in chunks from
added file paths and, in **sized mode with STORED**, exposes the exact total length up front so we
can set `Content-Length`. `stream-zip` is the alternative; `zipstream-ng`'s `len()`-when-sized is
the deciding feature here.

### Content-Length — the part that needs care

A correct `Content-Length` is what turns the browser's spinner into a real progress bar, but a wrong
one **breaks the download** (truncated / hung). With STORED the per-entry overhead is deterministic,
so the total is computable — *if the member set is exact*. Therefore:

- **`os.stat` every source up front** and build the member list from files that actually exist,
  with their real sizes. The current builders silently `continue` past missing files mid-write;
  here that would desync the precomputed length, so missing files must be dropped **before** sizing.
- Let the library compute the total from that finalized list (filenames included — UTF-8 names and
  zip64 change header sizes; don't hand-roll the arithmetic).
- If anything makes the size unknowable, **omit `Content-Length`** and fall back to chunked transfer
  (indeterminate progress, but still no "preparing"). Never send a guessed length.

### Don't block the event loop

`zipstream-ng` is synchronous and reads files from disk. Iterating it directly in an async handler
would stall the loop. Wrap the iterator with `starlette.concurrency.iterate_in_threadpool` (or drive
it from a thread) so file reads happen off the loop. Document and test this — it's the easy thing to
get wrong.

### Auth for a browser navigation (also fixes a latent bug)

A streamed download is triggered by `<a href>` navigation (so the browser's own download manager
owns it), which **cannot send an `Authorization` header**. `get_optional_gallery_token` today reads
the JWT *only* from the bearer header — which is why the existing `<a>`-based file download already
**401s for password-protected galleries** (no header on a navigation). The streaming endpoint takes
the gallery JWT as a **`?token=` query param** (the same pattern the public WebSocket uses — see the
realtime invariant in `CLAUDE.md`), validated server-side like `require_gallery_token`. Folding the
existing `download_public_zip` onto the same `?token=` acceptance closes the password-gallery gap.

> Query-string tokens can land in proxy logs. Acceptable here: it's a short-lived, gallery-scoped
> JWT, and it mirrors the already-accepted WS handshake. Don't widen this to admin tokens.

### Side effects (download notification)

Keep the existing notify+log behaviour from `_record_download`: enqueue the `download` notification
and `activity_service.log_download`, still **skipping the photographer's own** (`is_admin`) download.
Fire it when the stream **starts** (headers sent) — a started multi-GB stream is a real download
intent; tying it to completion would miss aborted-but-mostly-finished transfers.

### Correctness carry-overs

- **Moderation:** the public stream must use `only_approved=True` when listing images. (Note: the
  current `build_zip_multi` calls `image_repo.get_by_gallery` *without* `only_approved`, so pending
  client uploads can leak into a public ZIP — fix this in the rewrite.)
- Preserve name de-dup (`name-N.ext`) and the sub-gallery → folder mapping (root images under
  `safe_folder(gallery.name)` when sub-galleries are also selected, else flat).

## Trade-offs (and what we keep)

- **No resume / Range.** A dropped connection restarts from zero. For huge archives over flaky links
  the old build-to-file path (a `FileResponse` supports ranges) is more robust. **Keep the
  job-based endpoints** as-is for: the **admin** export (`zip_export.py`), and as an optional
  fallback. Streaming becomes the default for the public "download all / selection".
- **A worker is held for the transfer duration** (bounded by client bandwidth). Guard with a small
  concurrency **semaphore** on streaming downloads (return 503/“try again” when saturated) plus the
  existing rate limit, so a few slow clients can't exhaust the threadpool on a low-end box.
- **No `ZipJob` row / cleanup** for streamed downloads — one less thing to purge, but also no
  server-side record that a build happened (the activity log still captures the download).

## Why this beats prebuild/cache (option C) for the stated problem

Prebuilt/cached ZIPs only help the *second* download of an *unchanged* gallery, cost a full extra
on-disk copy (bad on a small VPS), and need content-signature invalidation. STORED + streaming makes
the **first** download fast for **everyone** with no extra disk. Cache stays a later, optional add-on
for the narrow "same large gallery downloaded repeatedly" case — and could itself just cache the
streamed output.

## Testing

- Build a gallery + sub-galleries with known files; stream it; assert: 200, `Content-Type`
  `application/zip`, a `Content-Length` that **equals** the received byte count, and that the archive
  opens with the expected entries + folder structure + de-duped names.
- Missing-source file → excluded, and `Content-Length` still matches the actual stream.
- Password gallery: streams with a valid `?token=`, 401 without.
- Moderation: a pending client upload is **absent** from the public stream.
- Event loop not blocked (a concurrent request returns while a large stream is in flight).
- `>4 GB` / `>65535` entries: zip64 path produces a valid archive (can be a size-arithmetic unit
  test rather than a real multi-GB fixture).

## Migration / rollout

1. Backend: add the streaming endpoint; refactor the member-list assembly out of `zip_task.py` so
   both the streamer and the legacy builders share it.
2. Frontend: `useGalleryZip.start/startImages` → build the stream URL (with `?token=`) and
   `triggerBrowserDownload` it directly; drop the poll for the public path. Keep a brief
   "starting…" state until navigation begins; remove the indeterminate "preparing" spinner.
3. Leave admin export on the job flow (resume-friendly for large studio downloads).

## Out of scope

- Prebuild/cache (option C) — separate, optional.
- Range/resume for streamed archives.
- Per-image progress within the archive (the browser's byte-level progress is enough).
