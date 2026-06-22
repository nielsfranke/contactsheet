# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""ContactSheet ML sidecar — semantic-search embedding service.

A tiny, internal-only HTTP API the backend calls to turn images and text queries into vectors.
Not exposed publicly: it trusts its caller (the backend on the same Docker network) and reads
image files by path from the shared `/data` volume. Three endpoints:

    POST /embed/image  {"path": "/data/uploads/<gid>/medium/<file>", "model": "…"} -> {"vector": [...]}
    POST /embed/text   {"text": "team photo with trophy", "model": "…"}            -> {"vector": [...]}
    GET  /health                                                                    -> {"status", "model", "ready"}

The model is loaded lazily on the first request so the container starts fast and uses no memory
until search is actually exercised.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from runtime import MODEL_NAME, encoder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("contactsheet-ml")

# Confine file reads to the shared data root — the backend only ever passes paths under it, and
# this blocks a malformed/hostile path from reaching the rest of the container filesystem.
DATA_ROOT = os.path.realpath(os.environ.get("DATA_ROOT", "/data"))

app = FastAPI(title="ContactSheet ML", docs_url=None, redoc_url=None)


class ImageRequest(BaseModel):
    path: str
    model: str | None = None


class TextRequest(BaseModel):
    text: str
    model: str | None = None


class VectorResponse(BaseModel):
    vector: list[float]
    dim: int
    model: str


def _safe_path(path: str) -> str:
    resolved = os.path.realpath(path)
    if resolved != DATA_ROOT and not resolved.startswith(DATA_ROOT + os.sep):
        raise HTTPException(status_code=400, detail="path outside data root")
    if not os.path.isfile(resolved):
        raise HTTPException(status_code=404, detail="file not found")
    return resolved


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_NAME, "ready": encoder.ready}


@app.post("/embed/image", response_model=VectorResponse)
def embed_image(req: ImageRequest) -> VectorResponse:
    path = _safe_path(req.path)
    try:
        vector = encoder.embed_image(path)
    except Exception as exc:  # noqa: BLE001 — surface a clean 500 to the backend, which retries/marks error
        logger.exception("image embed failed for %s", path)
        raise HTTPException(status_code=500, detail=f"embed failed: {exc}") from exc
    return VectorResponse(vector=vector, dim=len(vector), model=MODEL_NAME)


@app.post("/embed/text", response_model=VectorResponse)
def embed_text(req: TextRequest) -> VectorResponse:
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    try:
        vector = encoder.embed_text(text)
    except Exception as exc:  # noqa: BLE001
        logger.exception("text embed failed")
        raise HTTPException(status_code=500, detail=f"embed failed: {exc}") from exc
    return VectorResponse(vector=vector, dim=len(vector), model=MODEL_NAME)
