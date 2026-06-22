# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.config import settings
from app.database import get_db
from app.notifications import presets, url_guard
from app.rate_limit import limiter
from app.repositories import settings_repo
from app.schemas.notifications import mask_settings, merge_incoming
from app.schemas.settings import AppSettingsResponse, AppSettingsUpdate, ResetRequest
from app.version import __version__
from app.services import notification_service, reset_service
from app.utils import assert_image_magic, read_limited

router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])

# Raster formats only. SVG is intentionally excluded: it can carry inline script that executes if a
# visitor opens the served /branding/<file>.svg URL directly, and is served untrusted alongside
# public galleries. Raster logos cover the need without the active-content risk.
_LOGO_MIMES = {"image/png", "image/webp", "image/jpeg"}


def _to_response(s) -> AppSettingsResponse:
    logo_url = f"/branding/{s.logo_filename}" if s.logo_filename else None
    return AppSettingsResponse(
        version=__version__,
        instance_name=s.instance_name,
        accent_color=s.accent_color,
        accent_gradient=s.accent_gradient,
        logo_filename=s.logo_filename,
        logo_url=logo_url,
        admin_theme=s.admin_theme,
        admin_locale=s.admin_locale,
        lightbox_backdrop=s.lightbox_backdrop,
        brand_display=s.brand_display,
        brand_font=s.brand_font,
        brand_color=s.brand_color,
        tagline=s.tagline,
        public_base_url=s.public_base_url,
        source_url=s.source_url,
        high_res_previews=s.high_res_previews,
        preset_presentation=s.preset_presentation,
        preset_collaboration=s.preset_collaboration,
        admin_grid_mode=s.admin_grid_mode,
        admin_grid_view=s.admin_grid_view,
        overview_size=s.overview_size,
        overview_shape=s.overview_shape,
        overview_spacing=s.overview_spacing,
        overview_corners=s.overview_corners,
        overview_sort=s.overview_sort,
        overview_sort_dir=s.overview_sort_dir,
        gallery_sort=s.gallery_sort,
        gallery_sort_dir=s.gallery_sort_dir,
        footer_enabled=s.footer_enabled,
        footer=s.footer,
        notifications=mask_settings(s.notifications),
        semantic_search=s.semantic_search,
        activity_ip_logging=s.activity_ip_logging,
        activity_ip_retention_days=s.activity_ip_retention_days,
    )


@router.get("", response_model=AppSettingsResponse)
def get_settings(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    return _to_response(settings_repo.get(db))


@router.patch("", response_model=AppSettingsResponse)
def update_settings(
    body: AppSettingsUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    updates = {}
    if body.instance_name is not None:
        updates["instance_name"] = body.instance_name
    if body.accent_color is not None:
        updates["accent_color"] = body.accent_color
    if body.accent_gradient is not None:
        updates["accent_gradient"] = body.accent_gradient
    if body.admin_theme is not None:
        updates["admin_theme"] = body.admin_theme
    if body.admin_locale is not None:
        updates["admin_locale"] = body.admin_locale
    if body.lightbox_backdrop is not None:
        updates["lightbox_backdrop"] = body.lightbox_backdrop
    # "" clears the override/default, a URL sets it; omitted leaves it unchanged.
    for url_field in ("public_base_url", "source_url"):
        if url_field in body.model_fields_set:
            updates[url_field] = getattr(body, url_field) or None
    # "" clears, a value sets, omitted leaves unchanged.
    for clear_field in ("brand_color", "tagline"):
        if clear_field in body.model_fields_set:
            updates[clear_field] = getattr(body, clear_field) or None
    # An object replaces the whole preset/override/footer; explicit null clears it.
    for preset_field in ("preset_presentation", "preset_collaboration", "admin_grid_view", "footer"):
        if preset_field in body.model_fields_set:
            preset = getattr(body, preset_field)
            updates[preset_field] = preset.model_dump(exclude_none=True) if preset else None
    # Notifications: merge over stored so masked/blank channel URLs keep their stored credentials.
    if "notifications" in body.model_fields_set:
        if body.notifications is None:
            updates["notifications"] = None
        else:
            stored = settings_repo.get(db).notifications
            updates["notifications"] = merge_incoming(stored, body.notifications.model_dump())
    # Semantic search: object replaces the whole config; explicit null clears it. Enabling it or
    # changing the model (re)queues the library for indexing — see semantic_search_service.
    semantic_before = settings_repo.get(db).semantic_search
    if "semantic_search" in body.model_fields_set:
        updates["semantic_search"] = body.semantic_search.model_dump() if body.semantic_search else None
    # Admin-only view + footer scalars.
    for field in ("admin_grid_mode", "overview_size", "overview_shape", "overview_spacing", "overview_corners", "overview_sort", "overview_sort_dir", "gallery_sort", "gallery_sort_dir", "footer_enabled", "brand_display", "brand_font", "activity_ip_logging", "activity_ip_retention_days"):
        if getattr(body, field) is not None:
            updates[field] = getattr(body, field)
    resize_previews = (
        body.high_res_previews is not None
        and body.high_res_previews != settings_repo.get(db).high_res_previews
    )
    if body.high_res_previews is not None:
        updates["high_res_previews"] = body.high_res_previews
    s = settings_repo.update(db, **updates) if updates else settings_repo.get(db)
    if resize_previews:
        # Bring existing thumb/medium files in line with the new setting (background).
        from app.tasks.preview_upgrade import upgrade_previews_async
        upgrade_previews_async()
    if "semantic_search" in body.model_fields_set:
        # Enabling search, or switching encoder, (re)queues the library for indexing in the
        # background. Disabling is a no-op for stored vectors (they're just ignored).
        from app.services import semantic_search_service
        semantic_search_service.on_settings_change(db, semantic_before, s.semantic_search)
    return _to_response(s)


@router.get("/semantic-search/status")
def semantic_search_status(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Index progress (indexed/pending/error/skipped) + ML sidecar health for the settings panel."""
    from app.services import semantic_search_service
    return semantic_search_service.status(db)


@router.post("/semantic-search/reindex")
def semantic_search_reindex(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Re-queue every image that still needs indexing (manual nudge after errors / a stuck sidecar).
    No-op unless the feature is enabled and a sidecar is configured."""
    from app.tasks import embed_task
    embed_task.run_backfill()
    from app.services import semantic_search_service
    return semantic_search_service.status(db)


class _NotificationTest(BaseModel):
    channel_id: str | None = None
    # An unsaved/edited channel being composed in the UI: build the URL from these.
    type: str | None = None
    params: dict[str, str] | None = None
    url: str | None = None


@router.post("/notifications/test")
@limiter.limit("5/minute")
def test_notification(
    request: Request,
    body: _NotificationTest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Send a one-off test message. The channel comes from explicit ``type``+``params`` / ``url``
    (a channel being composed with real, unmasked credentials) or, when those are absent/masked,
    from the stored channel resolved by ``channel_id`` (so saved secrets need not be re-entered).

    Per-IP rate-limited (this synchronous endpoint is the most direct SSRF/scan oracle); the
    optional internal-target guard is enforced here so the admin gets a clear error rather than a
    generic send failure."""
    url = ""
    if body.type or body.url:
        url = presets.build_url(body.type or "custom", body.params, (body.url or "").strip())
        if url and "••" in url:  # masked secrets slipped through — fall back to the stored channel
            url = ""
    if not url and body.channel_id:
        stored = (settings_repo.get(db).notifications or {}).get("channels", [])
        match = next((c for c in stored if c.get("id") == body.channel_id), None)
        if match:
            url = presets.build_url(match.get("type", "custom"), match.get("params"), match.get("url", ""))
    if not url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No notification URL to test")
    blocked = url_guard.block_reason(url)
    if blocked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=blocked)
    instance_name = settings_repo.get(db).instance_name
    ok = notification_service.send_test(url, instance_name)
    if not ok:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Notification failed to send")
    return {"ok": True}


@router.post("/logo", response_model=AppSettingsResponse)
def upload_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    mime = file.content_type or ""
    if mime not in _LOGO_MIMES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="PNG, JPEG, or WebP required")

    ext = {
        "image/png": ".png",
        "image/webp": ".webp",
        "image/jpeg": ".jpg",
    }[mime]

    data = read_limited(file)
    assert_image_magic(data, mime)
    filename = f"{uuid.uuid4()}{ext}"
    os.makedirs(settings.branding_dir, exist_ok=True)
    with open(os.path.join(settings.branding_dir, filename), "wb") as f:
        f.write(data)

    # Delete old logo
    s = settings_repo.get(db)
    if s.logo_filename:
        old = os.path.join(settings.branding_dir, s.logo_filename)
        if os.path.exists(old):
            os.unlink(old)

    s = settings_repo.update(db, logo_filename=filename)
    return _to_response(s)


@router.delete("/logo", status_code=204)
def delete_logo(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    s = settings_repo.get(db)
    if s.logo_filename:
        old = os.path.join(settings.branding_dir, s.logo_filename)
        if os.path.exists(old):
            os.unlink(old)
        settings_repo.update(db, logo_filename=None)


@router.post("/reset")
@limiter.limit("3/minute")
def factory_reset(
    request: Request,
    body: ResetRequest,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    """Factory reset: purge all galleries, media, feedback and settings, clear the admin
    account, and rotate the secret key. Password-confirmed and irreversible — the next
    request lands on the setup wizard. See docs/architecture/factory-reset.md."""
    reset_service.factory_reset(body.password, db)
    return {"ok": True}
