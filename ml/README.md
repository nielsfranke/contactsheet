# ContactSheet ML sidecar

CPU-only ONNX embedding service that powers **semantic content search** (find photos by what's
visible in them). It is an **optional** add-on: the default ContactSheet deploy never builds or
pulls it, and the feature stays off until an admin enables it.

## What it is

A tiny FastAPI service wrapping a multilingual **SigLIP 2 (base)** encoder, run via ONNX Runtime —
**no PyTorch**, so the image stays small. The backend calls it over the internal Docker network:

| Endpoint | Purpose |
|---|---|
| `POST /embed/image` `{path, model}` | vector for an image read by path from the shared `/data` volume |
| `POST /embed/text` `{text, model}` | vector for a free-text query |
| `GET /health` | liveness + loaded-model info |

Vectors are L2-normalized; the backend ranks by dot product (= cosine). Image files are passed
**by path** (both containers mount `/data`), so no multi-MB upload per image.

## Running it

```bash
# Enable the optional profile and point the backend at the sidecar (see .env.example):
echo "ML_SERVICE_URL=http://ml:8001" >> .env
docker compose --profile ml up -d --build
```

The model weights (~a few hundred MB, INT8) download once on first request into `/data/ml-cache`.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `MODEL_ID` | `onnx-community/siglip2-base-patch16-256-ONNX` | HuggingFace repo (Transformers.js ONNX layout) |
| `MODEL_NAME` | `siglip2-base-multilingual` | logical name stored with each vector — **must match** `app_settings.semantic_search.model` |
| `ONNX_QUANTIZED` | `1` | INT8 graphs (smaller/faster on CPU); `0` = full precision |
| `ORT_INTRA_THREADS` | `4` | CPU inference threads (keep below host core count) |
| `TEXT_MAX_LEN` | `64` | SigLIP text tower token length |

## Switching models — validate the graph shape

`runtime.py` is wired for the default `onnx-community/siglip2-base-patch16-256-ONNX` (validated
2026-06-22): both towers output the embedding as **`pooler_output`**, the text tower takes only
`input_ids`, and the repo ships **only quantized** graphs plus a **fast `tokenizer.json`** (no
SentencePiece). If you point `MODEL_ID` at a different export, its ONNX input/output names may
differ — adjust `_VISION_OUTPUT` / `_TEXT_OUTPUT` and the input keys in `runtime.py` (the single
place that knows the graph shape). Quick check once the container is up:

```bash
curl -s localhost:8001/health
curl -s -X POST localhost:8001/embed/text -H 'content-type: application/json' \
     -d '{"text":"a cat"}' | head -c 120
```

A 200 with a non-empty `vector` array means the wiring is correct.
