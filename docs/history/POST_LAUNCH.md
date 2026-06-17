# POST_LAUNCH.md — Code Review (2026-06-11)

Comprehensive review of backend (FastAPI/SQLAlchemy/SQLite), frontend (Next.js/React Query), and Docker/nginx setup. Issues verified against the actual code; the two crash bugs in 🔴 were reproduced/confirmed, not just suspected.

---

> ## Triage status — 2026-06-13
>
> All 33 findings re-checked against the current code — **all 33 fixed**.
>
> - ✅ **Critical (3/3):** C1, C2, C3
> - ✅ **Important (15/15):** I1–I15 — *I7 is fixed twice over (slowapi + nginx `limit_req`)*
> - ✅ **Nice-to-have (15/15):** N1–N15
>
> Each item below is tagged inline with its status.

---

## 🔴 Critical

### ✅ C1. `NameError` crash: `gallery_repo` never imported in galleries router

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/routers/galleries.py:141` (also 154, 164, 172)
`upload_header_image` and `delete_header_image` call `gallery_repo.get_by_id(...)` / `gallery_repo.update(...)`, but the module never imports `gallery_repo`. Every header-image upload or delete throws `NameError` → HTTP 500. The feature is fully wired in the UI (`HeaderImageUpload.tsx`) and is dead on arrival.

**Fix:**
```python
# backend/app/routers/galleries.py — extend the existing import
from app.repositories import activity_repo, gallery_repo, vote_repo
```
**Estimate:** 5min

---

### ✅ C2. Gallery expiry crashes every public request with `TypeError`

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/services/gallery_service.py:145`
```python
if gallery.expires_at and gallery.expires_at < datetime.now(timezone.utc):
```
SQLite (via SQLAlchemy's `DATETIME`) strips tzinfo on storage and returns **naive** datetimes — confirmed with this project's exact SQLAlchemy version: comparing the read-back value with an aware `datetime.now(timezone.utc)` raises `TypeError: can't compare offset-naive and offset-aware datetimes`. The moment any gallery has `expires_at` set, **all** public endpoints for it 500 instead of returning 410.

**Fix:**
```python
if gallery.expires_at:
    expires = gallery.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This gallery has expired")
```
Related: `zip_job_repo.purge_expired` compares the same way inside SQL (works by string-compare luck today) — normalize there too.
**Estimate:** 15min

> Note: this bug is currently *latent* only because of I1 below — there is no way to set `expires_at` at all.

---

### ✅ C3. Watermark protection is trivially bypassable

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/app/services/image_service.py:34-36`, `backend/app/routers/public.py:66-78`, `nginx.conf:6-11`
When watermarking is enabled, the frontend lightbox requests `/api/public/g/{token}/images/{id}/medium` (watermarked). But the public images API (`get_public_images`) still returns `medium_url` and `thumb_url` pointing straight at `/uploads/{gallery}/medium/{file}.jpg`, which nginx serves **with no auth and no watermark**. Anyone can open dev tools / the JSON response and pull every clean medium-resolution file, defeating the entire feature. (If `downloads_enabled` is on, clean originals are also handed out alongside the watermark setting.)

**Fix:** when watermark is enabled, return the watermarked API route as the medium URL and omit the direct path:
```python
# image_service._image_to_response — add share_token + watermarked params
if image.processing_status == "done":
    thumb_url = storage.get_url(f"{gallery_id}/thumb/{sf}")
    if watermarked and share_token:
        medium_url = f"/api/public/g/{share_token}/images/{image.id}/medium"
    else:
        medium_url = storage.get_url(f"{gallery_id}/medium/{sf}")
```
and in `public.py:get_public_images`, pass `watermarked=watermark_enabled, share_token=share_token` (compute `watermark_enabled` the same way `get_public_gallery` does). Consider forcing `original_url = None` while watermarking is on, and watermarking thumbs (or accepting thumbs as low-value).
**Estimate:** 30min+

---

## 🟠 Important

### ✅ I1. Gallery expiration cannot be set — feature gap end to end

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/app/schemas/gallery.py` (`GalleryCreate`/`GalleryUpdate`), `frontend/src/components/admin/GalleryForm.tsx`
The model, migration, public 410 handling, and `GalleryExpired.tsx` all exist, but neither create/update schema has an `expires_at` field and the admin form has no expiry input. The roadmap lists "expiration UI" as done; it isn't reachable.

**Fix:** add `expires_at: datetime | None = None` to both schemas, pass it through `gallery_service.create_gallery`/`update_gallery`, add a date input to `GalleryForm`. Fix C2 first.
**Estimate:** 30min+

### ✅ I2. Upload buffers entire files in RAM before the size check

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/services/image_service.py:96-101`
`data = file.file.read()` loads the whole file into memory, *then* checks `len(data) > max_upload_bytes`. nginx allows 2 GB bodies (`client_max_body_size 2G`), and uploads are multi-file — a single request can balloon the backend by gigabytes before any rejection.

**Fix:** check size while streaming:
```python
CHUNK = 1024 * 1024
size = 0
with open(tmp_path, "wb") as out:
    while chunk := file.file.read(CHUNK):
        size += len(chunk)
        if size > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail="File exceeds maximum upload size")
        out.write(chunk)
```
(or at minimum seek-to-end of the spooled file to check size before reading). Also consider lowering nginx's limit to ~250 MB on `/api/galleries/.*/images` since the app cap is 200 MB.
**Estimate:** 30min+

### ✅ I3. Header-image, logo, and watermark uploads have no size limit at all

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/app/routers/galleries.py:151-152`, `backend/app/routers/admin_settings.py:68`, `backend/app/routers/images.py:77`
All three do `file.file.read()` unbounded (up to nginx's 2 GB) and only check the client-supplied `Content-Type`. Admin-only, but one fat-fingered drop writes 2 GB into `/data/branding`.

**Fix:** shared helper, e.g.:
```python
def read_limited(file: UploadFile, max_bytes: int = 10 * 1024 * 1024) -> bytes:
    data = file.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail="File too large")
    return data
```
**Estimate:** 15min

### ✅ I4. ZIP filter `"flagged"` never matches anything

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/tasks/zip_task.py:24-25`
```python
if filter_type != "all":
    images = [img for img in images if img.color_flag == filter_type]
```
`ZipJobCreate` accepts `filter_type="flagged"` (`schemas/zip_job.py`), but no image ever has `color_flag == "flagged"`, so the job always errors "No images match filter". The admin dropdown happens not to offer it, but the API and TS types do.

**Fix:**
```python
if filter_type == "flagged":
    images = [img for img in images if img.color_flag != "none"]
elif filter_type != "all":
    images = [img for img in images if img.color_flag == filter_type]
```
**Estimate:** 5min

### ✅ I5. `image_votes` unique constraint exists in the model but not the database

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/alembic/versions/0003_phase3.py` (image_votes table), `backend/app/repositories/vote_repo.py:25-53`
The model declares `UniqueConstraint("image_id", "reviewer_name")` but migration 0003 never creates it, and `vote_repo.upsert` is a non-atomic select-then-insert. Two concurrent votes from the same reviewer create duplicate rows, which double-count in the admin voting summary. This is also silent schema drift between ORM and DB.

**Fix:** new migration:
```python
op.create_index("uq_image_votes_image_reviewer", "image_votes",
                ["image_id", "reviewer_name"], unique=True)
```
(dedupe existing rows first), and catch `IntegrityError` in `upsert` with a retry-as-update.
**Estimate:** 15min

### ✅ I6. Admin frontend has no 401 handling — expired session looks like data loss

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `frontend/src/lib/api.ts:23-38`, `frontend/src/app/admin/layout.tsx:19-25`
Admin "auth" is a sessionStorage flag never validated against the server, and the JWT cookie expires after 24 h. After expiry every query 401s, React Query swallows it into `data = []`, and the admin sees an **empty gallery list** with no redirect — looks like everything was deleted.

**Fix:** in `request()`:
```typescript
if (res.status === 401 && window.location.pathname.startsWith("/admin")) {
  clearAuthenticated();
  window.location.href = "/login";
}
```
and/or call `api.auth.me()` in the admin layout instead of trusting sessionStorage.
**Estimate:** 15min

### ✅ I7. No rate limiting on admin login or gallery password auth

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/app/routers/auth.py:11`, `backend/app/routers/public.py:47-63`, `nginx.conf`
Both password endpoints accept unlimited attempts. bcrypt slows each try, but a single shared gallery password (often short, often shared in email) is brute-forceable, and the admin login is internet-exposed by design.

**Fix (cheapest, at nginx):**
```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
location ~ ^/api/(auth/login|public/g/.+/auth)$ {
    limit_req zone=auth burst=5 nodelay;
    proxy_pass http://backend:8000;
    # ... same proxy headers as /api/
}
```
or `slowapi` in FastAPI if you want app-level control.
**Estimate:** 30min+

### ✅ I8. Session cookie hardcoded `secure=False`

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/routers/auth.py:19`
The admin token cookie is always sent over plain HTTP, even when deployed behind HTTPS. The comment says "set to True when behind HTTPS" but there's no switch.

**Fix:** add `cookie_secure: bool = False` to `Settings` and use `secure=settings.cookie_secure`; document `COOKIE_SECURE=true` in `.env.example` for HTTPS deployments.
**Estimate:** 5min

### ✅ I9. python-jose 3.3.0 has known CVEs

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/requirements.txt:7`
python-jose 3.3.0 is affected by CVE-2024-33663 (algorithm confusion) and CVE-2024-33664 (JWE decode DoS). Your HS256-only usage with pinned `algorithms=["HS256"]` limits exposure, but the package is effectively unmaintained.

**Fix:** swap to PyJWT (drop-in for this usage):
```python
import jwt  # PyJWT
jwt.encode(payload, settings.secret_key, algorithm="HS256")
jwt.decode(token, settings.secret_key, algorithms=["HS256"])
```
**Estimate:** 30min+

### ✅ I10. Watermarked medium endpoint re-renders the JPEG on every request

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/routers/public.py:134-175`
Each view decodes the medium JPEG, composites the watermark, re-encodes, and returns — Pillow CPU per image per visitor. The `ETag` header is set but `If-None-Match` is never checked, so the 1-hour `Cache-Control` is the only relief. A 200-image gallery viewed by 10 clients = 2000 full JPEG re-encodes.

**Fix:** cache composited output to disk keyed by image id + watermark settings hash (`/data/uploads/{gid}/medium-wm/{hash}/{file}`), serve with `FileResponse`; invalidate the directory on watermark change. Also return 304 when `request.headers.get("if-none-match")` matches.
**Estimate:** 30min+

### ✅ I11. Images stuck in `pending` forever if the process restarts mid-processing

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/app/tasks/image_processing.py:74`, `backend/app/main.py:31-47`
Thumbnails are generated via in-process `BackgroundTasks`. A restart/crash between DB insert and completion leaves `processing_status="pending"` permanently; the admin page then polls every 3 s forever (`refetchInterval` in `admin/galleries/[id]/page.tsx:36-40`) and the image never appears publicly.

**Fix:** in the startup hook, requeue or fail stale rows:
```python
db.execute(update(Image)
    .where(Image.processing_status == "pending")
    .values(processing_status="error"))
```
(or better: re-dispatch `process_image` for each pending row since originals are on disk).
**Estimate:** 30min+

### ✅ I12. Dev mode: `/uploads` is proxied to the backend, which doesn't serve it

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `frontend/next.config.ts` (rewrites), `backend/app/main.py`
In production nginx serves `/uploads`; in dev the Next.js rewrite forwards `/uploads/*` to `http://localhost:8000/uploads/*`, but FastAPI never mounts a static directory — every thumbnail 404s when running outside Docker.

**Fix:**
```python
from fastapi.staticfiles import StaticFiles
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
app.mount("/branding", StaticFiles(directory=settings.branding_dir), name="branding")
```
(harmless in prod since nginx intercepts those paths first).
**Estimate:** 5min

### ✅ I13. Docker: root containers, no `.dockerignore`, dead venv baked into the image, no resource limits

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `Dockerfile`, `docker-compose.yml`, missing `.dockerignore`
- No `USER` directive — backend and frontend run as root; a Pillow/zipfile exploit gets root in-container.
- No `.dockerignore`, so the build context ships `data/` (your photos + DB) and `COPY backend/ ./` copies `backend/.venv` (hundreds of MB of host-platform binaries) into the image.
- `docker-compose.yml` sets no memory/CPU limits; combined with I2, one upload burst can OOM the host.

**Fix:**
```
# .dockerignore
data/
backend/.venv/
frontend/node_modules/
frontend/.next/
.git/
```
```dockerfile
# Dockerfile, backend stage, after COPY
RUN useradd -r -u 1001 appuser && chown -R appuser /app
USER appuser
```
```yaml
# docker-compose.yml, per service
    mem_limit: 1g
    cpus: "2.0"
```
(volume `/data` must be writable by uid 1001).
**Estimate:** 30min+

### ✅ I14. Soft-deleted parent galleries leave children live and files on disk forever

> **Triage 2026-06-13:** DONE. Disk-cleanup of stale soft-deleted galleries was already
> shipped (startup `rmtree` after 7 days). The soft-delete cascade existed but was only one
> level deep; `gallery_repo.soft_delete` now walks the **entire subtree** (unlimited nesting),
> so no descendant is left reachable via its own share token. Verified with a 4-level tree.
**Files:** `backend/app/services/gallery_service.py:131-135`, `backend/app/repositories/gallery_repo.py:49-53`
`delete_gallery` soft-deletes only the one row. Sub-galleries keep `deleted_at = NULL`, stay reachable via their public share tokens (invisible in the admin tree, since the parent is filtered out — unreachable for you, still live for clients). Image files and originals are never removed from disk for deleted galleries/images.

**Fix:** cascade the soft delete to children in `delete_gallery`, and add a cleanup job (startup or cron) that removes `/data/uploads/{gallery_id}` for galleries soft-deleted more than N days ago.
**Estimate:** 30min+

### ✅ I15. Comment text length is unbounded

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/schemas/comment.py` (`CommentCreate.text`)
`text: str = Field(..., min_length=1)` has no `max_length`; the public comment endpoint accepts multi-megabyte bodies into SQLite from anyone with a share link.

**Fix:** `text: str = Field(..., min_length=1, max_length=2000)` (and `maxLength` on the input in `CommentPanel.tsx`).
**Estimate:** 5min

---

## 🟡 Nice-to-have

### ✅ N1. N+1 queries when building the gallery tree

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/services/gallery_service.py:21-52`
`_build_response` runs 3 queries per gallery (image count, cover image, comment count); the admin sidebar refires this on every invalidation. Fine at 20 galleries, slow at 200.
**Fix:** batch with three `GROUP BY gallery_id` queries up front and pass dicts into `_build_response`. **Estimate:** 30min+

### ✅ N2. A reviewer named "totals" corrupts the voting summary

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/routers/galleries.py:103-105`
Reviewer names are used as dict keys next to the reserved `"totals"` key in the same object. A reviewer literally named `totals` overwrites the tally.
**Fix:** nest names under a `"reviewers"` sub-dict (`images[id] = {"totals": ..., "reviewers": {...}}`) and adjust `VotingSummary.tsx` casts. **Estimate:** 15min

### ✅ N3. Like counter has a read-modify-write race and no dedup

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/services/image_service.py:183`
`likes=image.likes + 1` loses concurrent increments, and one client can spam unlimited likes.
**Fix:** `db.execute(update(Image).where(Image.id == image_id).values(likes=Image.likes + 1))`; dedup needs a per-client key if you ever care. **Estimate:** 5min

### ✅ N4. Slideshow progress bar resets itself every render

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `frontend/src/components/gallery/Slideshow.tsx:9-18`
The `useEffect` has **no dependency array**, so each `setProgress` re-render tears down and restarts the interval with a fresh `start` — the bar crawls near 0% while re-rendering every 50 ms.
**Fix:** add `[]` as the dependency array. **Estimate:** 5min

### ✅ N5. ZIP entries use raw client filenames — zip-slip and silent overwrites

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/tasks/zip_task.py:38`
`arcname=img.original_filename` can contain `../` (written into the archive verbatim; hostile to whoever extracts) and duplicate filenames produce a ZIP where extraction silently overwrites.
**Fix:** `arcname = os.path.basename(img.original_filename)` plus a `-1`, `-2` suffix on collisions. **Estimate:** 15min

### ✅ N6. `ZIP_TTL_HOURS` constant ignores the `zip_ttl_hours` setting

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/repositories/zip_job_repo.py:9` vs `backend/app/config.py:16`
The config knob exists but the repo hardcodes 24.
**Fix:** `from app.config import settings` … `timedelta(hours=settings.zip_ttl_hours)`. **Estimate:** 5min

### ✅ N7. Path traversal guard in LocalStorage is incomplete

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/storage/local.py:12-15`
`os.path.normpath(p).lstrip("/")` does not strip leading `..` segments (`normpath("a/../../x") → "../x"`). Not currently exploitable (all callers build paths from validated gallery IDs + UUID filenames), but it's the designated safety net and it doesn't hold.
**Fix:**
```python
full = os.path.realpath(os.path.join(self._base_dir, relative_path))
if not full.startswith(os.path.realpath(self._base_dir) + os.sep):
    raise ValueError("Path escapes storage root")
```
**Estimate:** 5min

### ✅ N8. SVG logo upload is a stored-XSS vector

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/routers/admin_settings.py:15` (`image/svg+xml` allowed), served raw from `/branding/` by nginx
An SVG with embedded `<script>` executes when opened directly. Only admins can upload, so impact is low, but it's free to harden.
**Fix:** add `add_header Content-Security-Policy "script-src 'none'";` to the nginx `/branding/` block (or drop SVG). **Estimate:** 15min

### ✅ N9. Upload validation trusts the client `Content-Type` only

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/app/services/image_service.py:85-92` and all branding/watermark uploads
No magic-byte sniff; a renamed non-image is stored under `/uploads` with an image extension (admin-only writers, and Pillow processing fails it to `error`, so risk is low).
**Fix:** validate the first bytes (`data[:3] == b"\xff\xd8\xff"` for JPEG, `\x89PNG`, `RIFF....WEBP`) before saving. **Estimate:** 15min

### ✅ N10. No security headers or API timeouts in nginx

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `nginx.conf`
Missing `X-Frame-Options`/`frame-ancestors` (clickjacking on the admin), no `proxy_connect_timeout`, and `client_max_body_size 2G` applies to every endpoint including login.
**Fix:** `add_header X-Frame-Options DENY;` + `add_header Referrer-Policy strict-origin-when-cross-origin;` at server level; scope the 2G body limit to the upload location only (default 1m elsewhere). **Estimate:** 15min

### ✅ N11. Deprecated `@app.on_event("startup")`

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `backend/app/main.py:31`
Deprecated in FastAPI 0.109+; will eventually break on upgrade.
**Fix:** migrate to a `lifespan` context manager and pass `lifespan=lifespan` to `FastAPI(...)`. **Estimate:** 15min

### ✅ N12. Dead code / unused imports

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `backend/app/routers/images.py:2` (`os` unused), `backend/app/routers/zip_export.py:16` (`request_base` param always `""`), `backend/app/config.py:17` + `models/image.py:41-42` (`max_video_bytes`, `is_video`, `video_poster_filename` unused until the video feature lands — fine, but flag them in a TODO), repeated inline `from app.repositories import image_repo` inside functions in `public.py` (move to top).
**Estimate:** 5min

### ✅ N13. No "delete gallery" button in the admin UI

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**Files:** `frontend/src/app/admin/galleries/[id]/page.tsx`, `GalleryTree.tsx`
`DELETE /api/galleries/{id}` and `api.galleries.delete` exist, but nothing in the UI calls them — galleries are immortal without curl.
**Fix:** destructive button in the edit dialog with confirm. Land I14 (cascade) first. **Estimate:** 15min

### ✅ N14. PasswordGate reports every failure as "Wrong password"

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `frontend/src/components/gallery/PasswordGate.tsx:24-30`
Network errors and 5xx also show "Wrong password".
**Fix:** branch on `err.status === 401` for the wrong-password toast, generic message otherwise. **Estimate:** 5min

### ✅ N15. UploadZone index math races on concurrent drops

> **Triage 2026-06-13:** DONE — fixed and verified in code.
**File:** `frontend/src/components/admin/UploadZone.tsx` (`startIndex = files.length` inside `uploadFiles`)
Two overlapping drops compute overlapping index ranges, mislabeling progress/status rows. Cosmetic.
**Fix:** track per-batch IDs (e.g. `crypto.randomUUID()` per FileState) instead of positional indexes. **Estimate:** 15min

---

## Notes (no action required, but be aware)

- **Capability-URL model:** `/uploads/**` is served by nginx with no auth. Password protection gates the *API listing*, but anyone who ever obtained an image URL (UUID-based, unguessable) keeps it forever — links never expire or rotate. That's the same tradeoff Google Photos shared links make; document it in the README so users with strict confidentiality needs know. Fixing it properly means signed URLs or `X-Accel-Redirect`, which is a Phase-4-sized change.
- **Reviewer identity is honor-system:** `reviewer_name` is client-chosen; reviewers can vote as each other. Acceptable for a trusted-team feature — just don't present the voting matrix as tamper-proof.
- **Logout doesn't revoke the JWT** (stateless tokens, 24 h TTL) — standard tradeoff, fine at this scale.

## Suggested order of attack

1. **Today (≈1 h):** C1, C2, I4, I8, I12, I15, N4, N6 — all 5–15 min, mostly one-liners, two of them fix hard 500s.
2. **This week:** C3 + I1 (the watermark/expiry features as actually-working features), I5, I6, I7, I13.
3. **Before traffic grows:** I2/I3, I10, I11, I14, then the 🟡 list opportunistically.
