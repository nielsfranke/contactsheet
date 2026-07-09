# Broad file-format support — Phase 1 (TIFF, PSD, camera RAW)

Status: **implemented** (Phase 1, 2026-06-22). Decisions: `max_upload_bytes` → **300 MB**;
client-upload path **also** accepts the new formats (existing size caps apply); RAW via **`rawpy`**.

> **Superseded in part by [psb-support.md](psb-support.md) (2026-06-22).** This doc rejects PSB with
> `upload_psb_unsupported` (see Detection + "Why this stays lean" below). That decision was reversed
> the same month: PSB is now **accepted**, previewed from the thumbnail Photoshop embeds near the
> start of the file — no heavy decoder, no convert sidecar. `detect_format` returns
> `Format("psb", …)` instead of a rejection, the `upload_psb_unsupported` error code is gone, and a
> PSB without an embedded thumbnail lands as `processing_status="no_preview"` (stored + downloadable,
> no rendition). Everything else in this doc still holds.

**Verified:** backend + frontend suites green; detector unit-tested across all families; TIFF upload
renders to `done`; PSB rejected with `upload_psb_unsupported`. `rawpy==0.24.0` installs from a
self-contained wheel on `python:3.12-slim` (no apt/Dockerfile change).

**Live RAW validation (2026-06-22)** against 8 CC0 samples from the [PIXLS.US raw database]
(https://raw.pixls.us/) — all public domain. Each ran the real path
(`detect_format` → `_open_source`/`rawpy.extract_thumb` → rendition): **8/8 produced JPEG
renditions**, every make detected correctly (CR2/CR3, NEF, ARW, RAF, ORF, RW2, DNG).

| sample | detected | embedded preview |
|---|---|---|
| Canon EOS M200 `.cr3` | raw | 6000×4000 (full) |
| Nikon 1 AW1 `.nef` | raw | 4608×3072 (full) |
| Fujifilm GFX100RF `.raf` | raw | 4000×3000 |
| Adobe `.dng` (5D Mk III) | raw | 3960×2640 |
| Olympus E-M5 III `.orf` | raw | 3200×2400 |
| Panasonic DC-FZ45 `.rw2` | raw | 1920×1440 (~2 MP) |
| Sony DSC-HX95 `.arw` | raw | 1920×1080 (~2 MP) |
| Canon PowerShot S2 IS `.cr2` (2005) | raw | **128×96 (thumbnail only)** |

**Caveat surfaced by the test — embedded-preview size varies by camera.** Modern
interchangeable-lens bodies embed a full/near-full-res JPEG (ideal). Older compacts embed a small
(~2 MP) preview, and *very* old compacts (the 2005 CR2) embed only a 128×96 thumbnail → a low-res
rendition. This is the inherent trade-off of the lean (no-demosaic) path; **full demosaic to fix the
old-camera case is Phase 2**. For the realistic target (photographers shooting modern RAW) the
embedded preview is full-res. Scope is **preview generation only** — originals are already
stored untouched and downloadable, so "supporting" a format means teaching the rendition pipeline
to *read* it. Phase 2 (full RAW demosaic + PSB via an optional `contactsheet-convert` sidecar) is
explicitly **out of scope** here.

## Goal

Accept the formats photographers actually deliver — **TIFF (`.tif`/`.tiff`)**, **Photoshop
(`.psd`)**, and **camera RAW** (`.cr2 .cr3 .nef .arw .dng .raf .orf .rw2 .pef .srw …`) — and produce
the normal `thumb` / `small` / `medium` JPEG renditions for them. The original bytes are stored and
served for download exactly as today.

## Why this stays lean

- The **original is already stored as-is** and ZIP/download serve it untouched. No format-specific
  code touches the delivery path — only `process_image` (rendition generation) needs to read the
  pixels.
- **TIFF and PSD need zero new dependencies** — Pillow (already bundled) reads both: TIFF natively,
  PSD via `PsdImagePlugin` (the flattened composite — no layers, which is what delivery wants).
- **RAW uses the embedded preview, not a demosaic.** Every RAW file carries a camera-rendered JPEG
  preview (often full-res). Extracting it is ~milliseconds and *no* sensor decode — and it shows the
  photographer's own rendering, which is the right thing for a delivery app. The only new dependency
  is **`rawpy`** (libraw bindings). Its wheels bundle libraw, so **no system packages / Dockerfile
  changes**, and **`numpy` is already a backend dep** (semantic-search cosine ranking), so the net
  addition is small.
- **No DB migration.** `images.mime_type` is already a free-form string; no new columns.
- **PSB is rejected, not half-supported** — Pillow can't read it and the files are often
  multi-GB. Clean 415 with a dedicated error code; revisit in Phase 2. *(Superseded: PSB is now
  accepted via its embedded thumbnail — see [psb-support.md](psb-support.md).)*

## Format detection (the real change)

Today acceptance is keyed off the **browser-supplied `content_type`** (`_ALLOWED_MIMES`). That's
unreliable for TIFF/PSD/RAW (browsers often send `application/octet-stream` or empty). Phase 1
replaces MIME-trust with **content sniffing + extension disambiguation** in a new
`app/storage/format_detect.py`:

`detect_format(header: bytes, filename: str) -> Format | None`

| Magic (first bytes) | Disambiguation | Result |
|---|---|---|
| `FF D8 FF` | — | `jpeg` |
| `89 PNG` | — | `png` |
| `RIFF`…`WEBP` | — | `webp` |
| `II*\0` / `MM\0*` (TIFF) | ext ∈ {.tif,.tiff} → TIFF; ext ∈ raw set (.cr2/.nef/.arw/.dng/.pef/.srw…) → RAW | `tiff` / `raw` |
| `8BPS` | version word `00 01` → PSD; `00 02` → PSB (*was reject; now accepted — see [psb-support.md](psb-support.md)*) | `psd` / `psb` |
| `FUJIFILMCCD-RAW` | — | `raw` (RAF) |
| `IIU\0` / `IIRO` / `MMOR` | — | `raw` (RW2 / ORF) |
| ISO-BMFF `ftyp` | brand `crx ` → RAW (CR3); else video as today | `raw` / `mp4`/`mov` |
| `1A 45 DF A3` (EBML) | — | `webm` |

Many RAW formats are TIFF-based, so magic alone can't separate a `.tif` from a `.cr2`/`.nef`/`.dng`
— **extension disambiguates** within the TIFF magic. Each `Format` maps to a category
(`pillow` vs `raw`) and a canonical stored extension; RAW keeps its real extension so the delivered
original opens in the right app.

`_check_magic` / `_ALLOWED_MIMES` / `_MAGIC` in `image_service.py` are replaced by this detector.
The upload loop calls `detect_format` on the temp file's header **after** streaming to disk (the
size cap still aborts mid-stream first), and rejects with `upload_unsupported_type` /
`upload_psb_unsupported` as appropriate.

## Rendition pipeline (`process_image`)

Branch right before `PilImage.open`, on the format derived from the stored extension:

- **pillow** (jpeg/png/webp/**tiff**/**psd**): `PilImage.open(original_path)` — unchanged path. The
  existing mode-conversion (`RGBA/P/LA/CMYK → RGB`), auto-rotate, resize, and EXIF/IPTC extraction
  all apply. (CMYK TIFFs convert approximately without an ICC transform — acceptable for previews.)
- **raw**: extract the embedded preview, then hand the result to the *same* downstream code:
  ```python
  with rawpy.imread(original_path) as raw:
      thumb = raw.extract_thumb()
  img = (PilImage.open(BytesIO(thumb.data)) if thumb.format == rawpy.ThumbFormat.JPEG
         else PilImage.fromarray(thumb.data))
  ```
  **No embedded preview → `status="error"`** (rare; full demosaic is Phase 2). EXIF comes from the
  preview JPEG (camera/lens/exposure usually present); IPTC may be absent on RAW — acceptable.

The decompression-bomb / `max_image_pixels` guard stays as-is and now also protects large TIFF/PSD.

## Semantic search (image embeddings)

The `contactsheet-ml` sidecar opens images with **plain Pillow** (`Image.open(path).convert("RGB")`),
which can't read camera RAW at all and reads PSD only as a fragile composite. With the default
`index_originals=True`, RAW/PSD would otherwise be handed their unreadable original and fail to index
(`embedding_status="error"`) — invisible to search.

Fix (`embed_task._use_original` + `format_detect.ml_can_read_original`): **RAW and PSD are always
indexed from the `medium` JPEG rendition**, regardless of `index_originals`; other formats honor the
setting. For RAW that rendition *is* the embedded camera preview, i.e. the best readable
representation we have (no demosaic), so this is correct rather than a downgrade. The medium file is
JPEG bytes stored under the original's name (e.g. `medium/uuid.cr2`), which Pillow opens by content.

**Verified end-to-end (2026-06-22):** for CC0 `.cr3` and `.nef` samples, `_use_original` selects the
rendition and the exact sidecar op `Image.open(medium).convert("RGB")` succeeds (2560×1707 RGB) — a
valid embedding input.

## Config & limits

- `max_upload_bytes` default is **200 MB**. RAW (20–60 MB) fits; large TIFF/PSD can exceed it.
  **Decision needed** (see below): keep 200 MB + document, or bump the admin default.
- `max_image_pixels` (100 MP) will error oversized TIFF/PSD panoramas — operator-tunable, left as-is.
- **Client-upload path**: the per-file cap (25 MB) makes TIFF/PSD/large-RAW impractical there.
  Phase 1 targets the **admin/photographer** upload. **Decision needed**: extend the client
  allow-list too (gated by the existing caps) or leave it JPEG/PNG/WebP/video.

## Frontend

- Extend `ACCEPTED_EXT` (`useImageUpload.ts`) with `.tif,.tiff,.psd` + the RAW extensions for the
  admin uploader.
- Add `errors.upload_psb_unsupported` (en/de) and map the new code in `getErrorCode`.
- **No viewer changes** — the grid/lightbox already show JPEG renditions; "download original" serves
  the RAW/PSD/TIFF bytes (expected for delivery).

## Tests

- Unit-test `detect_format` with crafted headers for every family (incl. PSD-vs-PSB version word,
  CR3 `ftyp crx`, TIFF-vs-CR2 by extension).
- Integration: a TIFF and a PSD fixture → renditions produced, `status="done"`. PSB header → 415
  `upload_psb_unsupported`. RAW extraction is covered by one small real fixture (e.g. a tiny DNG) if
  available, else the extraction branch is unit-tested against a stubbed `rawpy`.

## Files touched

| File | Change |
|---|---|
| `backend/app/storage/format_detect.py` | **new** — `detect_format` + `Format` registry |
| `backend/app/services/image_service.py` | replace MIME/`_check_magic` gate with detector; canonical ext from format |
| `backend/app/tasks/image_processing.py` | RAW branch (embedded-preview extraction) before resize |
| `backend/requirements*.txt` | add `rawpy` |
| `backend/app/config.py` | (optional) `max_upload_bytes` default bump |
| `frontend/src/hooks/useImageUpload.ts` | extend `ACCEPTED_EXT` |
| `frontend/messages/{en,de}.json` | `upload_psb_unsupported` string |
| `frontend/src/lib/api.ts` (`getErrorCode`) | map new code |
| `backend/tests/` | detector + pipeline tests |

## Decisions (resolved)

1. **`max_upload_bytes`** → **300 MB** (moderate bump; most TIFF/PSD fit, bounded disk risk).
2. **Client uploads** → **extended to the new formats too**; the existing per-file (25 MB) and
   per-request (250 MB) caps still gate them.
3. **RAW dependency** → **`rawpy`** (self-contained wheels, no system packages).
