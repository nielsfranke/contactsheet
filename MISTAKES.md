# MISTAKES

Log of what broke and why. The agent appends entries here (newest first) when it
breaks something or is corrected. Repeat entries graduate into hard rules in CLAUDE.md.

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
