# MISTAKES

Log of what broke and why. The agent appends entries here (newest first) when it
breaks something or is corrected. Repeat entries graduate into hard rules in CLAUDE.md.

## 2026-09-07 — Realtime rooms were per-gallery only, so API-created galleries never showed up

**What happened.** Galleries and sub-galleries created through the REST API (a desktop app on an
API token) didn't appear in an open admin overview until a manual refresh. The user retried
"because it didn't work" and got a real duplicate gallery — the writes always succeeded, only the
UI was stale.

**Root cause.** The realtime feature (2026-06-15) keyed every hub room by `gallery_id` and emitted
signals only for things *inside* a gallery (`image`, `flag`, `comment`, …). A freshly created
gallery has no room anyone could be watching, and no `gallery` event type existed. Creating in the
web UI masked the gap: `CreateGalleryDialog` invalidates `["galleries"]` locally, so the only
path that exercised "someone else changed the list" was an out-of-band client — which the feature
was never tested against.

**Prevention.** When adding a "live update" transport, enumerate the mutations by *who else can
cause them* (API tokens, second tab, background jobs), not by which screen the developer was
looking at. Any React Query key that a page reads but only its own mutations invalidate is a
staleness bug waiting for the first out-of-band writer — the local `invalidateQueries` in a
dialog is not proof the list is live.

## 2026-09-07 — Reimplemented SigLIP pre-processing with the wrong float order

**What happened.** Replacing `transformers` in the ML sidecar, the first `ImagePreprocessor` did
`np.asarray(img, dtype=np.float32) * (1/255)`. The tensor looked right (max deviation 1.2e-7, one
ULP) but the resulting *embeddings* drifted to cosine 0.985–0.993 against the old build's vectors
for the same photo — enough to silently degrade every already-indexed image, since old and new
vectors share one search space.

**Root cause.** `transformers.image_transforms.rescale` multiplies the `uint8` array by a Python
float, so NumPy promotes to float64 and rounds to float32 *once*. Multiplying in float32 rounds at a
different point. The INT8 quantized ONNX graph amplifies that one-ULP input difference into a
visible output difference — a magnitude that "obviously equivalent" float arithmetic doesn't suggest.

**Prevention.** When replacing a library's numeric pipeline whose output is *persisted and compared
later* (embeddings, hashes, checksums), the acceptance criterion is **bit-identical output**, never
"close enough" — and it must be checked on the real end-to-end output, not just the intermediate
tensor. Run old and new side by side over varied inputs and require max difference 0.0. Quantized
graphs make the usual float-tolerance intuition wrong.
