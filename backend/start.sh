#!/bin/sh
set -e

# Self-healing volume permissions. When started as root (the default), make sure the
# data + uploads dirs exist and the non-root app user (UID 1001) owns the mount points,
# then drop privileges and re-exec as that user. This handles a bind mount pointed at an
# existing host directory whose owner differs from the container user — otherwise uploads
# fail with "PermissionError [Errno 13] Permission denied: '/data/uploads/...'". Only the
# mount points are chown'd (not recursively), so startup stays fast on a large library.
# Running the container with an explicit `user:` (non-root) skips this and behaves as before.
if [ "$(id -u)" = "0" ]; then
  for d in /data /data/uploads /data/exports /data/branding /data/watermarks; do
    mkdir -p "$d"
    chown appuser "$d" 2>/dev/null || true
  done
  exec gosu appuser "$0" "$@"
fi

echo "Running database migrations..."
alembic upgrade head

echo "Starting ContactSheet API..."
# IMPORTANT: keep this single-worker. The in-memory rate limiter (app/rate_limit.py),
# the in-process notification flusher (app/main.py) and FastAPI BackgroundTasks all assume
# one process. Adding --workers >1 would duplicate notifications and break rate limiting;
# scale via multiple containers + a shared store instead.
#
# Trust X-Forwarded-* only when a reverse proxy is declared (TRUSTED_PROXY_HOPS > 0, the
# default). With hops=0 the app is directly exposed and uvicorn must keep the socket peer
# as the client address — a wildcard --forwarded-allow-ips would let anyone spoof
# X-Forwarded-For and bypass rate limiting (see app/rate_limit.py).
if [ "${TRUSTED_PROXY_HOPS:-1}" = "0" ]; then
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000
fi
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --forwarded-allow-ips "*"
