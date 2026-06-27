# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import logging
import os
import secrets
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.version import __version__
from app.errors import CodedHTTPException
from app.observability import RequestContextMiddleware, configure_logging, init_sentry
from app.rate_limit import limiter
from app.routers import auth, galleries, images, public
from app.routers import admin_settings, analytics, api_tokens, branding_icon, collections, realtime, search, setup, zip_export

# Configure structured logging + (optional) error tracking before anything else logs or raises.
configure_logging()
init_sentry()

_log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.exports_dir, exist_ok=True)
    os.makedirs(settings.branding_dir, exist_ok=True)
    os.makedirs(settings.watermarks_dir, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
    app.mount("/branding", StaticFiles(directory=settings.branding_dir), name="branding")

    from app.auth.password import hash_password
    from app.database import SessionLocal
    from app.models.gallery import Gallery
    from app.models.image import Image
    from app.repositories import settings_repo, zip_job_repo
    from app.runtime_config import set_secret_key, set_token_version
    from sqlalchemy import select as sa_select, update as sa_update

    db = SessionLocal()
    try:
        app_settings = settings_repo.get(db)

        # Resolve secret key: env → DB → auto-generate
        if settings.secret_key:
            sk = settings.secret_key
        elif app_settings.secret_key:
            sk = app_settings.secret_key
        else:
            sk = secrets.token_hex(32)
            settings_repo.update(db, secret_key=sk)
            app_settings = settings_repo.get(db)
            _log.info("Generated and persisted new secret key")
        set_secret_key(sk)
        # Load the admin-session generation so the auth dependency can check it without a DB hit.
        set_token_version(app_settings.token_version)

        # If env credentials are set and setup is not yet marked complete, auto-complete it
        if settings.admin_password and not app_settings.setup_complete:
            settings_repo.update(
                db,
                setup_complete=True,
                admin_username=settings.admin_username,
                admin_password_hash=hash_password(settings.admin_password),
            )
            _log.info("Auto-completed setup from environment credentials")

        result = db.execute(
            sa_update(Image)
            .where(Image.processing_status == "pending")
            .values(processing_status="error")
        )
        db.commit()
        if result.rowcount:
            _log.warning("Marked %d stuck-pending image(s) as error on startup", result.rowcount)

        # ZIP jobs run as in-process BackgroundTasks; a restart mid-build leaves them
        # un-terminal forever and the client polls indefinitely. Fail them on boot.
        from app.models.zip_job import ZipJob
        zip_result = db.execute(
            sa_update(ZipJob)
            .where(ZipJob.status.not_in(["ready", "error"]))
            .values(status="error", error_message="Interrupted by server restart")
        )
        db.commit()
        if zip_result.rowcount:
            _log.warning("Marked %d unfinished ZIP job(s) as error on startup", zip_result.rowcount)

        # Same for backup builds: an in-process BackgroundTask interrupted by a restart
        # leaves a job un-terminal forever, so the settings panel polls indefinitely.
        from app.models.backup_job import BackupJob
        backup_result = db.execute(
            sa_update(BackupJob)
            .where(BackupJob.status.not_in(["ready", "error"]))
            .values(status="error", error_message="Interrupted by server restart")
        )
        db.commit()
        if backup_result.rowcount:
            _log.warning("Marked %d unfinished backup job(s) as error on startup", backup_result.rowcount)

        cutoff_naive = (datetime.now(timezone.utc) - timedelta(days=7)).replace(tzinfo=None)
        stale = db.execute(
            sa_select(Gallery).where(
                Gallery.deleted_at.isnot(None),
                Gallery.deleted_at < cutoff_naive,
            )
        ).scalars().all()
        for g in stale:
            gallery_dir = os.path.join(settings.upload_dir, g.id)
            if os.path.isdir(gallery_dir):
                shutil.rmtree(gallery_dir, ignore_errors=True)
                _log.info("Removed upload dir for deleted gallery %s", g.id)

        count = zip_job_repo.purge_expired(db)
        if count:
            _log.info("Purged %d expired ZIP job(s) on startup", count)

        # Drop notification-outbox rows already sent before the ZIP TTL window.
        from app.models.notification import NotificationOutbox
        from sqlalchemy import delete as sa_delete
        outbox_cutoff = (datetime.now(timezone.utc) - timedelta(hours=settings.zip_ttl_hours)).replace(tzinfo=None)
        purged = db.execute(
            sa_delete(NotificationOutbox).where(
                NotificationOutbox.sent_at.isnot(None),
                NotificationOutbox.sent_at < outbox_cutoff,
            )
        )
        db.commit()
        if purged.rowcount:
            _log.info("Purged %d sent notification(s) on startup", purged.rowcount)

        # Scrub stored client IPs from activity rows past the retention window (privacy).
        from app.repositories import activity_repo
        retention_days = settings_repo.get(db).activity_ip_retention_days
        ip_cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).replace(tzinfo=None)
        scrubbed = activity_repo.scrub_ips_before(db, ip_cutoff)
        if scrubbed:
            _log.info("Scrubbed IPs from %d activity row(s) past retention on startup", scrubbed)
    finally:
        db.close()

    # Regenerate thumb/medium renditions created with older, smaller size settings (non-blocking).
    from app.tasks.preview_upgrade import upgrade_previews_async
    upgrade_previews_async()

    # Bind the running loop to the realtime hub so sync request code can broadcast live updates.
    import asyncio
    from app.realtime.hub import hub as realtime_hub
    realtime_hub.bind_loop(asyncio.get_running_loop())

    # Start the notification flusher (drains the outbox; coalesces bursts per gallery).
    from app.services import notification_service
    stop_event = asyncio.Event()
    flusher = asyncio.create_task(notification_service.run_flusher(stop_event))

    yield

    stop_event.set()
    flusher.cancel()
    try:
        await flusher
    except (asyncio.CancelledError, Exception):  # pragma: no cover
        pass


app = FastAPI(title="ContactSheet API", version=__version__, lifespan=_lifespan)

# Brute-force protection on auth endpoints (see app/rate_limit.py).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(CodedHTTPException)
async def _coded_http_exception_handler(request: Request, exc: CodedHTTPException):
    """Serialize client-visible errors with their stable ``code`` alongside the English detail."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code},
        headers=exc.headers,
    )

app.add_middleware(
    CORSMiddleware,
    # Dev convenience only: in production everything is same-origin behind nginx, so CORS
    # never triggers. Server-to-server calls (frontend container → backend) don't use CORS.
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added last → outermost: a request id is bound (and the access line logged) around everything else.
app.add_middleware(RequestContextMiddleware)

app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(galleries.router)
app.include_router(collections.router)
app.include_router(images.router)
app.include_router(public.router)
app.include_router(zip_export.router)
app.include_router(admin_settings.router)
app.include_router(api_tokens.router)
app.include_router(branding_icon.router)
app.include_router(realtime.router)
app.include_router(search.router)
app.include_router(analytics.router)


@app.get("/api/health")
def health():
    """Liveness: cheap, always 200 if the process is up."""
    return {"status": "ok", "version": __version__}


@app.get("/api/health/ready")
def health_ready():
    """Readiness: report each dependency a deploy relies on. 503 only if the DB (the one hard
    dependency) is down; `migrations: behind` flags an image pulled without `alembic upgrade head`.
    No secrets/paths in the payload, so it's safe to leave unauthenticated for probes."""
    from sqlalchemy import text

    from app import migrations
    from app.database import engine
    from app.ml import embedder

    checks: dict[str, str] = {}

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "error"

    try:
        db_rev = migrations.revision_of_db(migrations.sqlite_path())
        checks["migrations"] = "ok" if db_rev == migrations.current_head() else "behind"
    except Exception:
        checks["migrations"] = "unknown"

    if not embedder.is_configured():
        checks["ml_sidecar"] = "unconfigured"
    else:
        checks["ml_sidecar"] = "ok" if embedder.health() else "unreachable"

    writable = all(
        os.access(d, os.W_OK)
        for d in (settings.upload_dir, settings.exports_dir, settings.branding_dir, settings.watermarks_dir)
    )
    checks["storage"] = "ok" if writable else "error"

    if checks["database"] != "ok":
        overall, code = "error", 503
    elif checks["migrations"] in ("behind", "unknown") or checks["ml_sidecar"] == "unreachable" or checks["storage"] != "ok":
        overall, code = "degraded", 200
    else:
        overall, code = "ok", 200

    return JSONResponse(status_code=code, content={"status": overall, "version": __version__, "checks": checks})
