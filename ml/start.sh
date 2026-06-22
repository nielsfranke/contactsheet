#!/bin/sh
# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
set -e

# Self-healing cache permissions — mirrors the backend's start.sh. When started as root (the
# default), make sure the HuggingFace model-cache dir exists and is owned by the non-root app user
# (UID 1001), then drop privileges and re-exec as that user. Without this, a bind mount pointed at a
# host directory Docker created as root is unwritable by the container user, and *every* embed fails
# with "PermissionError [Errno 13] Permission denied: '/data/ml-cache/hub'" while /health still
# reports "online" (the model only loads lazily on the first request). Running the container with an
# explicit non-root `user:` skips this and behaves as before.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/ml-cache
  chown -R mluser /data/ml-cache 2>/dev/null || true
  exec gosu mluser "$0" "$@"
fi

exec uvicorn app:app --host 0.0.0.0 --port 8001
