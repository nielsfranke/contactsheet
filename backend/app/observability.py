# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Observability: structured logging, request correlation, and opt-in error tracking.

Three independently-useful, safe-by-default pieces (see docs/architecture/observability.md):

- ``configure_logging()`` — a dictConfig applied at startup. ``LOG_FORMAT=json`` emits one JSON
  object per line (with the request id + access fields); ``text`` keeps the human console output.
  Uvicorn's own loggers are folded in, and its access log is silenced in favour of our structured
  access line (see ``RequestContextMiddleware``).
- ``RequestContextMiddleware`` — binds a per-request id (inbound ``X-Request-ID`` or a fresh one)
  into a contextvar so every log line for one request is greppable, echoes it back as a header, and
  logs one access line per request (method/path/status/duration), skipping health probes.
- ``init_sentry()`` — a no-op unless ``SENTRY_DSN`` is set; never phones home by default. PII off,
  request bodies + auth headers scrubbed.
"""

import json
import logging
import logging.config
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.version import __version__

logger = logging.getLogger(__name__)
_access_logger = logging.getLogger("app.access")

# Carries the current request id across log records within one request (async-safe).
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

# Access fields a log record may carry (set via ``extra=`` on the access line).
_ACCESS_FIELDS = ("method", "path", "status", "duration_ms")


class RequestIdFilter(logging.Filter):
    """Stamp every record with the current request id (``-`` outside a request)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line — friendly to jq / Loki / any structured log shipper."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for key in _ACCESS_FIELDS:
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    """Apply the chosen format/level to the root + uvicorn loggers. Idempotent."""
    level = settings.log_level.upper()
    formatter = settings.log_format  # "text" | "json"

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {"request_id": {"()": RequestIdFilter}},
            "formatters": {
                "text": {
                    "format": "%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s",
                },
                "json": {"()": JsonFormatter},
            },
            "handlers": {
                "default": {
                    "class": "logging.StreamHandler",
                    "formatter": formatter,
                    "filters": ["request_id"],
                    "stream": "ext://sys.stdout",
                }
            },
            "root": {"level": level, "handlers": ["default"]},
            "loggers": {
                # Route uvicorn through the same handler/format…
                "uvicorn": {"handlers": ["default"], "level": level, "propagate": False},
                "uvicorn.error": {"handlers": ["default"], "level": level, "propagate": False},
                # …but silence uvicorn's own access log — our middleware emits a structured one.
                "uvicorn.access": {"handlers": [], "level": "WARNING", "propagate": False},
            },
        }
    )


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Bind a request id for the duration of the request and log a structured access line."""

    async def dispatch(self, request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_ctx.set(rid)
        start = time.perf_counter()
        try:
            response = await call_next(request)
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            path = request.url.path
            # Skip health probes so load-balancer polling doesn't drown the log.
            if not path.startswith("/api/health"):
                _access_logger.info(
                    "%s %s -> %s (%sms)",
                    request.method,
                    path,
                    response.status_code,
                    duration_ms,
                    extra={
                        "method": request.method,
                        "path": path,
                        "status": response.status_code,
                        "duration_ms": duration_ms,
                    },
                )
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            request_id_ctx.reset(token)


def _scrub_event(event: dict, _hint: dict) -> dict:
    """Belt-and-suspenders over send_default_pii=False: drop request bodies (they carry client
    photos + the admin password on login/restore) and redact auth headers/cookies before send."""
    req = event.get("request")
    if isinstance(req, dict):
        req.pop("data", None)
        req.pop("cookies", None)
        headers = req.get("headers")
        if isinstance(headers, dict):
            for name in list(headers):
                if name.lower() in ("authorization", "cookie"):
                    headers[name] = "[redacted]"
    return event


def init_sentry() -> None:
    """Initialize Sentry only when a DSN is configured; otherwise a complete no-op."""
    if not settings.sentry_dsn:
        return
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=__version__,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        before_send=_scrub_event,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            SqlalchemyIntegration(),
        ],
    )
    logger.info("Sentry error tracking enabled (environment=%s)", settings.sentry_environment)
