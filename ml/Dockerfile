# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

# ContactSheet ML sidecar: CPU-only ONNX embedding service for semantic search.
# Built and shipped separately from the main backend so the default deploy stays lean — only
# operators who enable Content Search pull this image.
FROM python:3.12-slim AS ml

WORKDIR /app

# libgomp1 is OpenMP runtime that ONNX Runtime links against for multi-threaded CPU inference.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY ml/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ml/ ./

# Cache downloaded model weights on the data volume so a restart doesn't re-download them.
ENV HF_HOME=/data/ml-cache
ENV ORT_INTRA_THREADS=4

# Non-root, matching the backend's UID for shared-volume read access.
RUN useradd -r -u 1001 mluser && mkdir -p /data/ml-cache && chown -R mluser /app /data/ml-cache
USER mluser

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8001/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
