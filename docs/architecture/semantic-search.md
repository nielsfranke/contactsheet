# Semantic content search ("find by what's in the photo")

Status: **implemented + validated** (2026-06-22) — backend, ML sidecar, admin settings panel, and
in-gallery search all shipped and exercised end-to-end locally (sidecar → 768-dim vectors → backend
client → search). Migration is `0037` (not `0036`, which was already taken). Vector ranking is
brute-force NumPy in the backend rather than `sqlite-vec`, to keep the backend image free of a
native extension; revisit if a library ever outgrows it.

**What on-host validation caught** (fixed in `ml/runtime.py`): for
`onnx-community/siglip2-base-patch16-256-ONNX`, both towers expose the embedding as
**`pooler_output`** (not `image_embeds`/`text_embeds`); the text tower takes only `input_ids`; the
repo ships **only quantized** graphs and a **fast `tokenizer.json`** (no SentencePiece `spiece.model`),
so we load `AutoImageProcessor` + a fast `AutoTokenizer`. Also recalibrated: SigLIP cosines are
small (a real match ≈ 0.08–0.12, noise ≈ 0.03–0.05), so the default threshold is **0.05** and the
settings slider operates in a 0–30% band — a 0.2 default would have filtered out every result.

Inspired by [picdrop's Content Search](https://www.picdrop.com/web/articles/new-content-search-in-picdrop):
find images by **what is visible in them** ("Auto bei Sonnenuntergang", "Team mit Pokal",
"Brautstrauß") instead of by filename, IPTC keyword, or sort order. No tagging, no manual metadata.

This is **semantic image retrieval via vision-language embeddings** (CLIP-family). There is no
"AI magic" beyond: encode every image to a vector once, encode the text query to a vector at search
time, rank by cosine similarity. picdrop's "Result Accuracy" slider (65 % …) is exactly a
**similarity threshold**.

The hard constraint, locked with the user: this must run on the production box — an **ASRock
Deskmini X300, Ryzen 5 5600G (6C/12T, Radeon iGPU treated as no usable accel), 27 GiB RAM** —
**without slowing the app down**, and **without bloating the Docker image**. If the image cost is
too high, we ship it as an **optional add-on container** so the base deploy pays nothing (see
[Deployment & image-size decision](#deployment--image-size-decision)). That packaging choice is the
escape hatch for "lassen wir es vielleicht": the feature can exist without forcing its weight on
anyone who doesn't enable it.

## Decisions to lock with the user

1. **Inference runtime = ONNX Runtime (CPU), not PyTorch.** Torch alone adds ~2–3 GB to an image
   and pulls CUDA cruft we can't use on a 5600G. ONNX Runtime CPU is ~50–200 MB and runs quantized
   models well on Zen 3. This is the single most important call for the size budget.
2. **Model = a *base*-size multilingual SigLIP 2, INT8-quantized ONNX.** Multilingual is
   non-negotiable — the user and clients search in German. Rationale and alternatives below.
3. **Packaging = optional sidecar container** (`contactsheet-ml`), not baked into the main backend
   image. Keeps the default image unchanged; the feature is opt-in at *deploy* time as well as in
   settings. (Fallback: in-process, if the user prefers one container — discussed below.)
4. **Scope = admin-only first.** picdrop restricts content search to owners/team, not clients. We
   match that: searching is an admin feature; public galleries are unaffected initially.
5. **Vector store = `sqlite-vec`** extension in the existing SQLite DB. No new datastore.

## Model choice — the part that decides feasibility

Reference point: **Immich** (self-hosted photo app, same deployment shape) ships exactly this as
"Smart Search" via selectable ONNX CLIP models, and the community has measured the CPU cost.

| Model | Multilingual | Size (ONNX, int8) | Why / why not |
|---|---|---|---|
| **SigLIP 2 base / patch16-256** *(recommended default)* | ✅ 100+ langs | ~350–450 MB | Best size/quality/multilingual balance; official ONNX exists ([onnx-community](https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX)), Transformers.js-grade quantization. Comfortable on a 5600G. |
| `mexma-siglip2` | ✅ strong multilingual | ~similar–larger | SigLIP2 vision + MEXMA multilingual text; higher quality, a bit heavier. Good upgrade path. |
| `jina-clip-v2` | ✅ 89 langs, Matryoshka (1024→64 dims) | ~0.9 B params | Excellent retrieval & truncatable vectors, but ~2–3× the compute of a base model — borderline for "don't slow anything down" on CPU. |
| `nllb-clip-large-siglip` | ✅ best native-lang recall | large (~4.2 GB RAM at runtime, ~75 ms/img on CPU per Immich users) | Highest non-English quality, but the RAM/latency footprint is the heavy end. Overkill here. |
| OpenAI CLIP / MobileCLIP2 | ❌ English-only | small | Fast and tiny but **English-only** — disqualified for German queries. |

**Recommendation: SigLIP 2 base (multilingual), INT8 ONNX, 256 px.** It is the sweet spot for this
exact box. Keep the model **pluggable** (config string) so swapping to `mexma-siglip2` or
`jina-clip-v2` later is a settings change, not a rewrite — mirroring how Immich lets you pick.

### Performance budget on the 5600G (estimates to validate, not promises)

- **Per-image encode:** a base ViT-B/16 INT8 on Zen 3 ≈ **30–80 ms single-thread**. For comparison,
  Immich users clock the *much heavier* nllb-large at ~75 ms/img and a 10-year-old 4-core i5 at
  ~1 img / 4 s; the 5600G with a base model is far faster.
- **Backfill throughput:** parallelized across a *bounded* worker pool (not all 12 threads — see
  below), realistically **several to a few-dozen images/sec**. A 50 k-image library indexes in
  roughly tens of minutes to ~1–2 h as a **one-time background job**, then only new uploads cost
  anything.
- **Query latency:** one text encode (~10–30 ms) + cosine over even 100 k vectors (brute-force or
  `sqlite-vec`) in **single-digit ms**. Effectively instant.
- **RAM:** base model + ORT session ≈ a few hundred MB resident. Trivial against 27 GiB.

### Not slowing the app down — the real risk

Inference is CPU-bound and the box also serves the app. Guardrails:
- **Bounded, low-priority worker pool**, capped well below core count (e.g. `OMP_NUM_THREADS` +
  pool size ≈ 2–4), so uploads/HTTP keep headroom. Never "use all 12 threads."
- **Indexing is queued and off the request path** — it rides the existing background-job pattern
  (like `ZipJob` / the notification flusher), never blocks an upload response.
- **Single ORT session, lazy-loaded** on first use; not loaded at all if the feature is disabled.
- If sidecar: the OS already isolates it; we can `cpus:` / `nice` it in compose.

## Deployment & image-size decision

This is the "wenn das Docker-Image zu groß wird, lassen wir es" gate. Concrete numbers:

- **Baked into backend image:** +ONNX Runtime (~150 MB) +model (~400 MB) +numpy/transformers
  tokenizer bits → **~+0.6–0.8 GB** to *every* deploy, even users who never enable search.
- **Optional sidecar `contactsheet-ml`** *(recommended)*: a separate image that only people who want
  the feature pull. The main backend stays byte-for-byte as today and talks to the sidecar over
  localhost HTTP (`POST /embed/image`, `POST /embed/text`). Mirrors Immich's `immich-machine-learning`
  split. **The base image does not grow at all.**

→ **Recommendation:** sidecar. It turns the size question from a trade-off into a non-issue — the
weight only lands on opt-in deployments, and we can drop the feature later by just not shipping one
container. Compose gains an optional service guarded behind a profile (`--profile ml`).

*Fallback if the user wants strictly one container:* run inference in-process and accept the
~+0.7 GB. Still far under a Torch-based build; acceptable but it taxes everyone.

## Data model

### Migration `0037` — embeddings + index status

*(`0036` is already taken by `show_filename_lightbox`.)*

- **`images.embedding_status`** (`TEXT`, default `'pending'`): `pending | indexed | skipped | error`.
  Mirrors `moderation_status`. `skipped` = videos and anything the model can't encode.
- **`image_embeddings`** table (or a `sqlite-vec` virtual table): `image_id` (PK/FK, cascade),
  `model` (TEXT — which encoder produced it, so a model swap can invalidate cleanly), `dim` (INT),
  `vector` (BLOB / `float[N]`), `created_at`. One row per image per model.
- **`app_settings.semantic_search`** (JSON, nullable) — same object-replace pattern as
  `notifications` / `footer`:
  ```jsonc
  {
    "enabled": false,            // opt-in, like picdrop (off by default)
    "model": "siglip2-base-multilingual",
    "default_threshold": 0.20,   // maps to picdrop's 65% accuracy slider baseline
    "index_originals": true
  }
  ```

Videos are `skipped` (no frame extraction in v1 — could index a poster frame later, noted as
future work). Watermark/branding assets are never indexed.

## Backend

- **`app/ml/embedder.py`** — thin client. If sidecar: HTTP to `contactsheet-ml`. If in-process: an
  `OnnxEmbedder` wrapping the ORT session with `encode_image(path) -> vec` / `encode_text(str) -> vec`,
  L2-normalized so cosine = dot product.
- **Pipeline hook** — after `image_processing` finishes thumbnails on the worker pool, enqueue an
  embed job for the new image (only when `enabled`). New uploads cost one encode, off the response
  path. The sidecar/pool backpressures so a bulk upload can't saturate the box.
- **Backfill job** — `app/tasks/embed_backfill.py`, a `BackgroundTasks` job like `build_zip()`:
  walks `embedding_status='pending'` in batches, updates status per row, resumable, cancellable.
  Triggered when the feature is first enabled or the model changes.
- **Search service** — `semantic_search_service.search(gallery_id, query, threshold)`:
  encode text → `sqlite-vec` KNN (or numpy cosine) → filter ≥ threshold → return image IDs ranked,
  then hydrate through the **existing** image serializer (so access rules, watermark proxy, soft-delete
  all still apply). No bypass of `image_repo`.
- **Repository** — `image_embedding_repo.py` for vector upsert/delete/KNN. Cascade-delete with the
  image; a re-index on model change wipes rows for the old `model`.

### API

```
GET  /api/galleries/{id}/search?q=…&threshold=0.2     # admin; semantic search within a gallery (+ subtree)
GET  /api/search?q=…&threshold=0.2                    # admin; across all galleries (optional, phase 2)
POST /api/admin/settings/semantic-search/reindex      # admin; (re)build the index as a job
GET  /api/admin/settings/semantic-search/status       # admin; { enabled, indexed, pending, error, model }
```

Query path reuses the gallery filter/sort response shape so the admin grid renders results with no
new card component. `threshold` defaults to `default_threshold`; the UI exposes it as picdrop's
accuracy slider.

## Frontend

- **Search box in `GalleryToolbar`** (admin side only initially) — free-text input; on submit, swap
  the grid to ranked results, with an **accuracy slider** (the threshold) and a "clear" affordance.
  Results reuse the existing image card + lightbox.
- **Settings** — a "Content search" panel under admin settings: master toggle, model display,
  index status + progress ("48,120 / 50,000 indexed"), and a "Re-index" action. Surfaces the
  one-time cost honestly, like picdrop's account-settings activation.
- **Disabled-state** — when `enabled=false` (or sidecar absent), the search box is hidden and the
  settings panel shows a one-click enable + what it will do.
- i18n: all new strings into `en.json`, validated via `scripts/validate-i18n.mjs`; German via Weblate.

## Feature invariants (proposed)

- **Embeddings never bypass access control.** Search returns image *IDs*; hydration goes through the
  normal serializer, so soft-deleted, moderation-pending, and watermark rules all still hold.
- **Index follows the lifecycle.** Upload → `pending`; delete → embedding row cascades; model change
  → old-`model` rows invalidated and re-queued. No orphan vectors.
- **Opt-in twice.** Off by default in settings *and* (if sidecar) absent unless the operator pulls
  the ML image. Zero cost to anyone who doesn't want it.
- **Bounded compute.** Inference runs on a capped low-priority pool; it must never starve HTTP or
  upload handling. "Don't slow the app down" is an invariant, not a hope.
- **Pluggable model.** The encoder is a config string; swapping models is a settings + re-index op.

## Open questions / future work

- **Sidecar vs. in-process** — recommended sidecar; needs the user's nod (the image-size escape
  hatch hinges on this).
- **Model pick** — SigLIP 2 base multilingual as default; confirm vs. `jina-clip-v2` (higher quality,
  heavier) given the box.
- **Public search** — deliberately deferred; picdrop keeps it owner/team-only too.
- **Video** — poster-frame indexing later; `skipped` for now.
- **Faces/people** as a *named* search ("team photo") work through CLIP semantics already; dedicated
  face *recognition/clustering* is a separate, heavier feature — explicitly out of scope here.

## Effort

Medium. All the scaffolding exists (background-job pattern, settings-JSON pattern, worker pool,
toolbar, migration flow). The genuinely new pieces are the ONNX embedder + (optional) sidecar
container and the `sqlite-vec` integration. The model/packaging decisions above are the gate; the
rest is wiring into established patterns.
