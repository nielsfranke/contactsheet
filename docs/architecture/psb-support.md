# PSB support — embedded thumbnail, no heavy decoder

Status: **implemented** (2026-06-22). Follow-up to
[broad-file-format-support.md](broad-file-format-support.md), which deliberately rejected PSB
(Photoshop large-document). This adds PSB **without** the heavy convert sidecar that the original
"Phase 2" assumed — it turns out we don't need one. No DB migration. Backend + frontend suites green;
PSB-with-thumbnail renders to `done`, PSB-without falls back to `no_preview`, both via synthetic
in-test PSBs (no large fixture).

## Decision

Accept `.psb` uploads. Generate a preview **from the thumbnail Photoshop embeds in the file**, which
is cheap to extract. When a file has no embedded thumbnail, fall back to a **placeholder tile** (the
original is still stored and downloadable). This matches the ask: preview when it's cheap, otherwise
a placeholder — never a heavyweight full decode.

## Why this is lean (the key insight)

A PSD/PSB file is laid out as: 26-byte header → color-mode data → **image resources** → layer/mask
info → **image data** (the full-resolution merged composite — this is the multi-GB part). The
embedded thumbnail lives in the **image resources** block, **near the start of the file**. So we read
only the first chunk (header + resources, normally well under a few hundred KB), extract a small
JPEG, and **never touch the giant image-data section**. No demosaic, no full decode, no
ImageMagick/libvips. Performance cost is negligible — that's why the preview path wins over a
placeholder here.

(Reading the *full* PSB composite would be the expensive path — full-res, hundreds of MP, GB in
memory. We explicitly don't do that; that would be the sidecar's job and is still out of scope.)

## Detection

`format_detect`: today `8BPS` + version word `\x00\x02` returns `kind="reject_psb"`. Change it to an
accepted format — `Format("psb", ".psb", "image/vnd.adobe.photoshop", "psb")`. Add
`is_psb_filename()` so the worker can route it. The `upload_psb_unsupported` rejection (and its en/de
string) is removed.

## Thumbnail extraction (new, pure-Python)

`app/storage/psd_thumbnail.py` → `extract_thumbnail(path) -> bytes | None`:

- Validate header (`8BPS`, version 2).
- Color-mode-data length and image-resources length are both **4-byte** fields in PSB (only
  layer/mask and image-data use 8-byte lengths) — so the resources block parses identically to PSD.
- Walk the resources block (`8BIM` + id(2) + Pascal name + size(4) + padded data) for **id 1036**
  (`kThumbnailResource`, JPEG) — fall back to **1033** (older BGR variant). The resource payload is
  a 28-byte thumbnail header followed by the JPEG bytes.
- Read is **bounded** (cap the resources scan to a few MB); return the JPEG bytes, or `None` if the
  resource is absent (e.g. saved without *Maximize Compatibility*).

## Pipeline + the new "no preview" state

`process_image` branches like the RAW path:

```
if format_detect.is_psb_filename(stored_filename):
    data = psd_thumbnail.extract_thumbnail(path)
    if data is None:
        # No embedded thumbnail → store as a download-only asset, no renditions.
        image_repo.update_processing_result(..., status="no_preview", width=None, height=None)
        return
    img = PilImage.open(io.BytesIO(data))   # then the normal rotate/resize/rendition path
```

`"no_preview"` is a **new `processing_status` value** (string column → **no DB migration**). It means
"stored and downloadable, but there is no thumbnail." A PSB *with* a thumbnail is just `"done"` like
any other image (low-res, but a real preview).

## Serializer & access

- `_image_to_response`: treat `"no_preview"` next to `"done"` — `thumb/small/medium` stay null,
  `original_url` is present, `is_video` false. Expose `processing_status` so the client can render the
  placeholder.
- The variant-serving proxy already guards on `processing_status != "done"`; a `no_preview` image has
  no variants to serve, so its thumb/medium endpoints simply never get called (urls are null).
- Public listing returns it like any image (no `processing_status` filter today); the public grid
  must render the placeholder too.

## Frontend

- **PhotoGrid** (`PhotoGrid.tsx`): a tile with no `thumb_url`, not a video, status `no_preview` →
  render a **placeholder card** (document/"PSB" badge via the existing `MediaBadge`/chrome + filename
  + download affordance) instead of an `<img>`.
- **Lightbox** (`Lightbox.tsx` / `lightbox-image-src.ts`): a `no_preview` item shows the placeholder
  + a download button, no `<img>`.
- A PSB *with* a thumbnail needs **no** special UI — it flows through as a normal (low-res) photo.
- `ACCEPTED_IMAGE_EXT` (+ client picker): add `.psb`.

## Semantic search

PSB is **excluded** (`embedding_status="skipped"`): a `no_preview` PSB has no pixels to embed, and an
embedded thumbnail is too small to give a meaningful vector. Keeps it simple and avoids junk vectors.

## Limits

- **Size cap.** PSB is often multi-GB; `max_upload_bytes` is 300 MB, so large PSB are rejected by the
  existing size guard. Operators raise `MAX_UPLOAD_BYTES` if they need bigger. The thumbnail trick
  doesn't change this — we still store the whole original on disk. **Documented, not auto-raised.**
- **Preview quality** is whatever Photoshop embedded (small, and only present with *Maximize
  Compatibility*). Full-resolution PSB rendering remains a future sidecar (out of scope).

## Tests

- Detector: PSB now **accepted** (update the existing `test_psb_upload_rejected_with_code`, which
  currently asserts a 415, to expect acceptance).
- Extraction: build a **synthetic minimal PSB** in-test (valid 8BPS v2 header + a resources block
  carrying a 1036 thumbnail wrapping a tiny real JPEG + empty trailing sections). Asserts a JPEG is
  returned and renders. A second synthetic PSB **without** the 1036 resource asserts the
  `no_preview` fallback. No multi-GB fixture committed.

## Files touched

| File | Change |
|---|---|
| `backend/app/storage/format_detect.py` | accept PSB; `is_psb_filename` |
| `backend/app/storage/psd_thumbnail.py` | **new** — `extract_thumbnail` |
| `backend/app/tasks/image_processing.py` | PSB branch + `no_preview` status |
| `backend/app/services/image_service.py` | drop the `upload_psb_unsupported` reject; serialize `no_preview` |
| `frontend/src/components/gallery/PhotoGrid.tsx`, `Lightbox.tsx`, `lightbox-image-src.ts` | placeholder tile/lightbox |
| `frontend/src/hooks/useImageUpload.ts`, `ClientUploadButton.tsx` | accept `.psb` |
| `frontend/messages/{en,de}.json` | placeholder label; drop `upload_psb_unsupported` |
| `backend/tests/` | detector + extraction/fallback tests |

## Decisions

1. **Placeholder appearance** → **minimal** (document icon + "PSB" badge + filename + download),
   reusing existing chrome.
2. **PSD stays as-is** — it renders its full composite via Pillow (better quality); only PSB uses the
   embedded-thumbnail path.
