# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Client for the optional `contactsheet-ml` sidecar.

The backend never loads an ML model itself — keeping its image free of any inference runtime. It
talks to a separate sidecar over localhost HTTP. Images are passed **by path**, not by bytes: both
containers mount the same `/data` volume, so the sidecar opens the file directly (no multi-MB
upload over the wire per image). Text queries are passed inline.

Every call raises `EmbedderError` on any failure (unconfigured, network, timeout, bad response) so
callers can degrade gracefully — indexing marks the image `error` and moves on; search surfaces a
clean "search unavailable" instead of a 500.
"""

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class EmbedderError(Exception):
    """A sidecar embedding call could not be completed."""


def is_configured() -> bool:
    return bool(settings.ml_service_url)


def _url(path: str) -> str:
    return f"{(settings.ml_service_url or '').rstrip('/')}{path}"


def _post_vector(endpoint: str, payload: dict) -> list[float]:
    if not is_configured():
        raise EmbedderError("ML service not configured")
    try:
        resp = httpx.post(_url(endpoint), json=payload, timeout=settings.ml_request_timeout)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise EmbedderError(f"{endpoint} failed: {exc}") from exc
    vector = data.get("vector") if isinstance(data, dict) else None
    if not isinstance(vector, list) or not vector:
        raise EmbedderError(f"{endpoint} returned no vector")
    return vector


def embed_image(image_path: str, model: str) -> list[float]:
    """Vector for an image the sidecar reads from the shared volume at `image_path`."""
    return _post_vector("/embed/image", {"path": image_path, "model": model})


def embed_text(text: str, model: str) -> list[float]:
    """Vector for a free-text query, comparable to image vectors of the same model."""
    return _post_vector("/embed/text", {"text": text, "model": model})


def health() -> dict | None:
    """Sidecar liveness + loaded-model info, or None if unreachable/unconfigured."""
    if not is_configured():
        return None
    try:
        resp = httpx.get(_url("/health"), timeout=5)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError):
        return None
