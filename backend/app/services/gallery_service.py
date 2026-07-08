# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import hashlib
import json
import os
import re
import secrets
import string
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings as app_config
from app.errors import CodedHTTPException

from app.auth.password import hash_password
from app.models.gallery import Gallery
from app.repositories import gallery_repo
from app.repositories import activity_repo
from app.repositories import comment_repo
from app.repositories import image_repo
from app.repositories import settings_repo
from app.schemas.gallery import (
    GalleryCreate,
    GalleryDerive,
    GalleryMetaResponse,
    GalleryPublicResponse,
    GalleryResponse,
    GalleryUpdate,
    SubGalleryNavItem,
)
from app.schemas.watermark import WatermarkSettings
from app.services import watermark_service
from app.storage.base import StorageProvider

# URL-safe slug: 3–80 chars, lowercase alphanumerics + hyphens, no leading/trailing hyphen.
_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$")
_RANDOM_ALPHABET = string.ascii_lowercase + string.digits
# 12 chars over a 36-symbol alphabet ≈ 62 bits of entropy — enough that an unlisted (password-less)
# gallery URL can't be brute-force-enumerated. Lookups match the token string verbatim and the
# column holds up to 80 chars, so older 8-char tokens already issued keep working unchanged.
_TOKEN_LENGTH = 12


def _random_token(db: Session, exclude_id: str | None = None) -> str:
    """A short, unique, URL-safe share token (12 chars)."""
    while True:
        token = "".join(secrets.choice(_RANDOM_ALPHABET) for _ in range(_TOKEN_LENGTH))
        if not gallery_repo.share_token_exists(db, token, exclude_id):
            return token


# Fields copied straight from GalleryUpdate to the model when not None.
_PASSTHROUGH_UPDATE_FIELDS = (
    "mode", "client_mode_switch_enabled",
    "layout", "sort_order", "downloads_enabled", "enable_team_voting",
    "opener_font", "opener_font_size", "opener_title_position",
    "opener_scrim", "opener_title_shadow",
    "preview_size", "preview_spacing",
    "preview_corners", "bg_brightness",
    "color_flags_enabled", "likes_enabled", "comments_enabled", "annotations_enabled",
    "sets_enabled", "client_upload_enabled", "client_upload_moderation",
    "show_filename", "show_filename_lightbox", "show_exif", "show_iptc",
    "hide_parent_nav",
)

# Subset cascaded to sub-galleries via apply_to_subgalleries (look & behaviour, not identity).
# hide_parent_nav cascades so a container can scope all its sub-galleries in one action.
# `mode` is deliberately EXCLUDED: applying settings to a subtree must never flip a child's mode —
# a container holds mixed Review + Showcase sub-galleries (e.g. "Work in Progress" review folders
# next to a "Final Deliveries" showcase), and "apply to all" should only propagate look & behaviour.
# See docs/proposals/gallery-per-container-mode-presets.md.
_CASCADE_FIELDS = (frozenset(_PASSTHROUGH_UPDATE_FIELDS) | {"bg_dimmed_color", "expires_at"}) - {"mode"}

# Copied from the parent when a sub-gallery is created (sort_order ranks siblings, so not that).
# hide_parent_nav is excluded — a new sub-gallery shouldn't silently inherit standalone scoping.
# `mode` IS inherited here (a new sub-gallery defaults to its parent's mode) even though it is not
# cascaded — creation and cascade are intentionally different for mode.
_INHERIT_CREATE_FIELDS = (_CASCADE_FIELDS | {"mode"}) - {"sort_order", "hide_parent_nav"}

# Fields a mode preset (app_settings.preset_*) may default at gallery creation.
# Mirrors schemas.settings.GalleryPreset.
_PRESET_FIELDS = frozenset({
    "layout", "opener_font", "opener_font_size", "opener_title_position",
    "opener_scrim", "opener_title_shadow",
    "preview_size", "preview_spacing",
    "preview_corners", "bg_brightness", "bg_dimmed_color",
    "downloads_enabled", "client_mode_switch_enabled", "enable_team_voting", "color_flags_enabled",
    "likes_enabled", "comments_enabled", "annotations_enabled", "sets_enabled",
    "show_filename", "show_filename_lightbox", "show_exif", "show_iptc",
})


def _resolve_create_defaults(db: Session, data: GalleryCreate, parent: Gallery | None) -> dict:
    """Look & behaviour for a new gallery, for fields the request didn't set explicitly.

    Sub-galleries copy their parent's look & behaviour — UNLESS created with an explicit mode that
    differs from the parent's, in which case the parent's (other-mode) settings don't fit and we
    fall back to the instance standard preset for the chosen mode, exactly like a top-level gallery.
    Top-level galleries always start from the instance preset for their mode. Explicit merge only —
    never **-splat stored JSON. See docs/proposals/gallery-per-container-mode-presets.md.
    """
    explicit = data.model_fields_set
    defaults: dict = {}
    inherit_from_parent = parent is not None and (
        "mode" not in explicit or data.mode == parent.mode
    )
    if inherit_from_parent:
        for field in _INHERIT_CREATE_FIELDS:
            if field not in explicit:
                defaults[field] = getattr(parent, field)
    else:
        app = settings_repo.get(db)
        mode = data.mode
        preset = (app.preset_collaboration if mode == "collaboration" else app.preset_presentation) or {}
        for field in _PRESET_FIELDS:
            if field in preset and field not in explicit:
                defaults[field] = preset[field]
    return defaults


def review_active(gallery: Gallery) -> bool:
    """Whether the review write endpoints (flag/rate/like/comment) are open for this gallery.

    True for Review galleries, and for Showcase galleries whose photographer opted into the
    client mode switch — the server can't know whether an individual client has toggled the
    view, so enabling the switch opens the endpoints (same trust model as Review mode)."""
    return gallery.mode == "collaboration" or gallery.client_mode_switch_enabled


def _header_image_url(gallery: Gallery) -> str | None:
    if not gallery.header_image_filename:
        return None
    return f"/branding/gallery-headers/{gallery.id}/{gallery.header_image_filename}"


def _uploaded_cover_url(gallery: Gallery) -> str | None:
    if not gallery.cover_image_filename:
        return None
    return f"/branding/gallery-covers/{gallery.id}/{gallery.cover_image_filename}"


def _effective_cover_url(gallery: Gallery, photo_cover, storage: StorageProvider) -> str | None:
    """Cover for the gallery card: an uploaded cover image wins; else the first/pinned photo."""
    uploaded = _uploaded_cover_url(gallery)
    if uploaded:
        return uploaded
    if photo_cover and photo_cover.processing_status == "done":
        return storage.get_url(f"{gallery.id}/thumb/{photo_cover.stored_filename}")
    return None


def _build_response(
    gallery: Gallery,
    db: Session,
    storage: StorageProvider,
    image_counts: dict[str, int] | None = None,
    cover_images: dict[str, object] | None = None,
    comment_counts: dict[str, int] | None = None,
) -> GalleryResponse:
    image_count = image_counts.get(gallery.id, 0) if image_counts is not None else gallery_repo.count_images(db, gallery.id)
    cover = cover_images.get(gallery.id) if cover_images is not None else gallery_repo.get_cover_image(db, gallery)
    cover_url = _effective_cover_url(gallery, cover, storage)
    gallery_comment_count = comment_counts.get(gallery.id, 0) if comment_counts is not None else comment_repo.count_by_gallery(db, gallery.id)
    return GalleryResponse.model_validate({
        **gallery.__dict__,
        "image_count": image_count,
        "comment_count": gallery_comment_count,
        "cover_image_url": cover_url,
        "header_image_url": _header_image_url(gallery),
        "children": [],
    })


def _build_tree(
    galleries: list[Gallery],
    db: Session,
    storage: StorageProvider,
    parent_id: str | None = None,
    image_counts: dict[str, int] | None = None,
    cover_images: dict[str, object] | None = None,
    comment_counts: dict[str, int] | None = None,
) -> list[GalleryResponse]:
    result = []
    for g in galleries:
        if g.parent_id == parent_id:
            node = _build_response(g, db, storage, image_counts, cover_images, comment_counts)
            node.children = _build_tree(galleries, db, storage, parent_id=g.id,
                                        image_counts=image_counts, cover_images=cover_images,
                                        comment_counts=comment_counts)
            result.append(node)
    return result


def list_gallery_tree(db: Session, storage: StorageProvider) -> list[GalleryResponse]:
    galleries = gallery_repo.get_all_active(db)
    ids = [g.id for g in galleries]
    image_counts = gallery_repo.batch_image_counts(db, ids)
    cover_images = gallery_repo.batch_cover_images(db, galleries)
    comment_counts = gallery_repo.batch_comment_counts(db, ids)
    return _build_tree(galleries, db, storage,
                       image_counts=image_counts, cover_images=cover_images,
                       comment_counts=comment_counts)


def get_gallery(db: Session, gallery_id: str, storage: StorageProvider) -> GalleryResponse:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    return _build_response(gallery, db, storage)


def create_gallery(db: Session, data: GalleryCreate, storage: StorageProvider) -> GalleryResponse:
    parent = None
    if data.parent_id:
        parent = gallery_repo.get_by_id(db, data.parent_id)
        if not parent:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent gallery not found")

    now = datetime.now(timezone.utc)
    kwargs = dict(
        id=str(uuid.uuid4()),
        parent_id=data.parent_id,
        name=data.name,
        description=data.description,
        password_hash=hash_password(data.password) if data.password else None,
        share_token=_random_token(db),
        mode=data.mode,
        layout=data.layout,
        sort_order=data.sort_order,
        downloads_enabled=data.downloads_enabled,
        enable_team_voting=data.enable_team_voting,
        headline=data.headline,
        expires_at=data.expires_at,
        created_at=now,
        updated_at=now,
    )
    # Parent / mode-preset values win over GalleryCreate's schema defaults; fields the
    # request set explicitly are never in the resolved dict.
    kwargs.update(_resolve_create_defaults(db, data, parent))
    gallery = gallery_repo.create(db, **kwargs)
    return _build_response(gallery, db, storage)


def derive_gallery(
    db: Session, source_gallery_id: str, data: GalleryDerive, storage: StorageProvider
) -> GalleryResponse:
    """Create a new gallery from a set of a gallery's images. The new gallery is a sub-gallery of
    the source (parent_id == source) or top-level (parent_id is None), and inherits the source's
    mode. Images are copied or moved into it."""
    from app.services import image_service  # local import avoids a service import cycle

    source = gallery_repo.get_by_id(db, source_gallery_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    if data.parent_id and not gallery_repo.get_by_id(db, data.parent_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent gallery not found")

    # Pre-validate at least one image belongs to the source, so we never create an empty gallery
    # and then fail (the bulk transfer re-checks and orders).
    live = {img.id for img in image_repo.get_by_gallery(db, source_gallery_id)}
    seen: set[str] = set()
    valid = [i for i in data.image_ids if i in live and not (i in seen or seen.add(i))]
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid images for the new gallery")

    new = create_gallery(
        db, GalleryCreate(name=data.name, parent_id=data.parent_id, mode=source.mode), storage
    )
    image_service.transfer_images(
        db,
        image_ids=valid,
        source_gallery_id=source_gallery_id,
        target_gallery_id=new.id,
        operation=data.operation,
        storage=storage,
    )
    try:
        activity_repo.log(
            db, source_gallery_id, "derived", "Admin",
            meta={"name": data.name, "count": len(valid), "operation": data.operation},
        )
    except Exception:
        pass
    return get_gallery(db, new.id, storage)


def update_gallery(
    db: Session, gallery_id: str, data: GalleryUpdate, storage: StorageProvider
) -> GalleryResponse:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    updates: dict = {}
    if data.name is not None:
        updates["name"] = data.name
    if data.description is not None:
        updates["description"] = data.description
    if data.watermark_settings is not None:
        try:
            normalized = WatermarkSettings.model_validate(json.loads(data.watermark_settings))
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid watermark settings")
        updates["watermark_settings"] = normalized.model_dump_json()
    if data.headline is not None:
        updates["headline"] = data.headline or None  # "" → None

    # Plain pass-through fields where None means "no change".
    for field in _PASSTHROUGH_UPDATE_FIELDS:
        value = getattr(data, field)
        if value is not None:
            updates[field] = value

    # `pinned` is handled separately (not in _PASSTHROUGH_UPDATE_FIELDS): it must never cascade to
    # sub-galleries or be inherited on create, since that set seeds _CASCADE_FIELDS.
    if data.pinned is not None:
        updates["pinned"] = data.pinned

    # `notifications_enabled` is operational (like pinned): never cascades, never inherited.
    if data.notifications_enabled is not None:
        updates["notifications_enabled"] = data.notifications_enabled

    # expires_at: None in payload = clear; omitted = no change
    if "expires_at" in data.model_fields_set:
        updates["expires_at"] = data.expires_at

    # bg_dimmed_color: explicit field set = apply (None clears it)
    if "bg_dimmed_color" in data.model_fields_set:
        updates["bg_dimmed_color"] = data.bg_dimmed_color

    # cover_image_id: explicit field set = apply (None clears, UUID pins). Pinning a photo as cover
    # also drops any uploaded cover so the chosen photo wins (uploaded cover otherwise takes precedence).
    if "cover_image_id" in data.model_fields_set:
        updates["cover_image_id"] = data.cover_image_id or None
        if data.cover_image_id:
            updates["cover_image_filename"] = None

    # header focus point: update when explicitly provided
    if data.header_focus_x is not None:
        updates["header_focus_x"] = data.header_focus_x
    if data.header_focus_y is not None:
        updates["header_focus_y"] = data.header_focus_y

    # password="" removes password, password=None means no change, non-empty sets new password
    if data.password is not None:
        updates["password_hash"] = hash_password(data.password) if data.password else None

    if updates:
        gallery = gallery_repo.update(db, gallery, **updates)

        # Cascade presentation/collaboration settings to the whole subtree when requested —
        # every descendant, not just direct children (galleries nest to any depth).
        # Identity fields (name/password/headline/watermark) are never cascaded.
        if data.apply_to_subgalleries:
            cascade = {k: v for k, v in updates.items() if k in _CASCADE_FIELDS}
            if cascade:
                for child in gallery_repo.get_descendants(db, gallery.id):
                    gallery_repo.update(db, child, **cascade)

    return _build_response(gallery, db, storage)


def move_gallery(
    db: Session, gallery_id: str, target_parent_id: str | None, storage: StorageProvider
) -> GalleryResponse:
    """Reparent a gallery: nest it under any gallery, or move it to the top level.

    Galleries nest to any depth; the only constraints are that the target isn't the gallery itself
    or one of its descendants (which would create a cycle).
    """
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    if target_parent_id == gallery_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A gallery can't be moved into itself")

    if target_parent_id is not None:
        target = gallery_repo.get_by_id(db, target_parent_id)
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target gallery not found")
        # Walk up from the target; the gallery being moved must not be one of its ancestors.
        node = target
        while node is not None:
            if node.id == gallery_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Can't move a gallery into its own sub-gallery",
                )
            node = gallery_repo.get_by_id(db, node.parent_id) if node.parent_id else None

    if gallery.parent_id == target_parent_id:
        return _build_response(gallery, db, storage)

    # Append at the destination level.
    if target_parent_id is None:
        siblings = [g for g in gallery_repo.get_all_active(db) if g.parent_id is None and g.id != gallery_id]
    else:
        siblings = [g for g in gallery_repo.get_children(db, target_parent_id) if g.id != gallery_id]
    gallery = gallery_repo.update(db, gallery, parent_id=target_parent_id, sort_order=len(siblings))
    return _build_response(gallery, db, storage)


def _slugify(text: str) -> str:
    """Lowercase, non-alphanumerics → hyphens, collapse repeats, trim, cap at 80 chars."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80].strip("-")
    return slug or "gallery"


def _unique_slug(db: Session, base: str, exclude_id: str) -> str:
    """Return `base`, or `base-2`, `base-3`, … until it's free."""
    if not gallery_repo.share_token_exists(db, base, exclude_id):
        return base
    n = 2
    while True:
        candidate = f"{base[:76]}-{n}"
        if not gallery_repo.share_token_exists(db, candidate, exclude_id):
            return candidate
        n += 1


def set_share_token(
    db: Session, gallery_id: str, strategy: str, value: str | None, storage: StorageProvider
) -> GalleryResponse:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    if strategy == "named":
        token = _unique_slug(db, _slugify(gallery.name), gallery.id)
    elif strategy == "random":
        token = _random_token(db, gallery.id)
    elif strategy == "custom":
        token = (value or "").strip().lower()
        if not _SLUG_RE.match(token):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Link must be 3–80 characters: lowercase letters, numbers and hyphens.",
            )
        if gallery_repo.share_token_exists(db, token, gallery.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That link is already taken.")
    else:  # unreachable given the schema Literal, but keep it explicit
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown strategy")

    gallery = gallery_repo.update(db, gallery, share_token=token)
    return _build_response(gallery, db, storage)


def delete_gallery(db: Session, gallery_id: str) -> None:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    gallery_repo.soft_delete(db, gallery)


def empty_gallery(db: Session, gallery_id: str) -> None:
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")
    gallery_repo.empty(db, gallery)


def get_public_gallery(
    db: Session, share_token: str, storage: StorageProvider
) -> tuple[Gallery, GalleryPublicResponse]:
    gallery = gallery_repo.get_by_share_token(db, share_token)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    if gallery.expires_at:
        expires = gallery.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise CodedHTTPException(
                status_code=status.HTTP_410_GONE,
                code="gallery_expired",
                detail="This gallery has expired",
            )

    # Public view: pending (unapproved) client uploads are invisible and don't count — so a gallery
    # whose only photos are pending reads as empty (container/content gate stays correct).
    image_count = gallery_repo.count_images(db, gallery.id, only_approved=True)
    cover = gallery_repo.get_cover_image(db, gallery)
    cover_url = _effective_cover_url(gallery, cover, storage)

    watermark_enabled = False
    if gallery.watermark_settings:
        try:
            watermark_enabled = watermark_service.is_active(json.loads(gallery.watermark_settings))
        except Exception:
            pass

    # Build navigation data: direct sub-galleries and parent info.
    raw_children = gallery_repo.get_children(db, gallery.id)
    child_ids = [c.id for c in raw_children]
    child_counts = gallery_repo.batch_image_counts(db, child_ids, only_approved=True) if child_ids else {}
    child_covers = gallery_repo.batch_cover_images(db, raw_children) if raw_children else {}
    subgalleries = []
    for c in raw_children:
        # Locally scoped so they don't clobber the gallery's own cover_url computed above.
        child_cover_url = _effective_cover_url(c, child_covers.get(c.id), storage)
        subgalleries.append(SubGalleryNavItem(
            name=c.name,
            share_token=c.share_token,
            image_count=child_counts.get(c.id, 0),
            cover_image_url=child_cover_url,
        ))
    parent_name: str | None = None
    parent_share_token: str | None = None
    parent_mode: str | None = None
    parent_cover_image_url: str | None = None
    ancestors: list[dict] = []
    # "Standalone access" makes a gallery a navigation boundary: clients can't see its parent or
    # ancestors (so a shared sub-gallery never reveals the parent container or its siblings).
    if gallery.parent_id and not gallery.hide_parent_nav:
        parent = gallery_repo.get_by_id(db, gallery.parent_id)
        if parent:
            parent_name = parent.name
            parent_share_token = parent.share_token
            parent_mode = parent.mode
            parent_cover = gallery_repo.get_cover_image(db, parent)
            parent_cover_image_url = _effective_cover_url(parent, parent_cover, storage)
        # Walk up for the breadcrumb, stopping (inclusive) at the first standalone ancestor so the
        # chain is clamped to the visible subtree.
        node = parent
        while node is not None:
            ancestors.insert(0, {"name": node.name, "share_token": node.share_token})
            if node.hide_parent_nav:
                break
            node = gallery_repo.get_by_id(db, node.parent_id) if node.parent_id else None

    app_settings = settings_repo.get(db)
    public = GalleryPublicResponse.model_validate({
        **gallery.__dict__,
        "image_count": image_count,
        "cover_image_url": cover_url,
        "watermark_enabled": watermark_enabled,
        "high_res_previews": app_settings.high_res_previews,
        "lightbox_backdrop": app_settings.lightbox_backdrop,
        "lightbox_zoom_enabled": app_settings.lightbox_zoom_enabled,
        "lightbox_zoom_max": app_settings.lightbox_zoom_max,
        "rating_mode": app_settings.rating_mode,
        "default_sort": app_settings.gallery_sort,
        "default_sort_dir": app_settings.gallery_sort_dir,
        "header_image_url": _header_image_url(gallery),
        "subgalleries": subgalleries,
        "parent_name": parent_name,
        "parent_share_token": parent_share_token,
        "parent_mode": parent_mode,
        "parent_cover_image_url": parent_cover_image_url,
        "ancestors": ancestors,
        "accent_color": app_settings.accent_color,
        # Global branding footer — only surfaced when enabled.
        "footer": app_settings.footer if app_settings.footer_enabled else None,
        # Studio identity for the client gallery header.
        "instance_name": app_settings.instance_name,
        "logo_url": f"/branding/{app_settings.logo_filename}" if app_settings.logo_filename else None,
    })
    return gallery, public


def _meta_image_path(gallery: Gallery, db: Session, storage: StorageProvider) -> str | None:
    """Filesystem path of the link-preview source: header → uploaded cover → first photo (medium).

    The og:image is *derived* from this (bounded small) rather than serving it raw — a multi-MB
    header otherwise breaks WhatsApp's link preview. Returns None when the file is absent on disk."""
    if gallery.header_image_filename:
        p = os.path.join(app_config.branding_dir, "gallery-headers", gallery.id, gallery.header_image_filename)
        return p if os.path.exists(p) else None
    if gallery.cover_image_filename:
        p = os.path.join(app_config.branding_dir, "gallery-covers", gallery.id, gallery.cover_image_filename)
        return p if os.path.exists(p) else None
    photo = gallery_repo.get_cover_image(db, gallery)
    if photo and photo.processing_status == "done":
        rel = f"{gallery.id}/medium/{photo.stored_filename}"
        if storage.exists(rel):
            return os.path.join(app_config.upload_dir, gallery.id, "medium", photo.stored_filename)
    return None


# In-process cache of rendered og:images, keyed on the ETag (source path + mtime + og params), like
# branding_icon. Small JPEGs; bounded in practice by the number of galleries with a preview image.
_OG_CACHE: dict[str, bytes] = {}


def get_og_image_source(
    db: Session, share_token: str, storage: StorageProvider
) -> tuple[str, str] | None:
    """(filesystem path, ETag) for a share link's preview image, or None when there's no controlled
    preview — unknown/expired token, password-protected gallery, or no image on disk. Cheap (a stat
    only), so a conditional 304 needn't read or resize the file."""
    gallery = gallery_repo.get_by_share_token(db, share_token)
    if not gallery:
        return None
    if gallery.expires_at:
        expires = gallery.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            return None
    if gallery.password_hash is not None:
        return None
    path = _meta_image_path(gallery, db, storage)
    if not path:
        return None
    sig = f"{path}|{os.path.getmtime(path)}|{app_config.og_image_max_px}|{app_config.og_image_quality}"
    return path, hashlib.sha1(sig.encode()).hexdigest()[:16]


def render_og_image(path: str, etag: str) -> bytes:
    """Bounded JPEG for the link preview (≤ og_image_max_px), cached on the ETag. Imported lazily to
    avoid pulling the Pillow pipeline into modules that only need gallery CRUD."""
    cached = _OG_CACHE.get(etag)
    if cached is not None:
        return cached
    from app.tasks.image_processing import resize_bytes

    with open(path, "rb") as f:
        raw = f.read()
    data = resize_bytes(raw, app_config.og_image_max_px, app_config.og_image_quality)
    # Bound the cache (FIFO) so churn over many galleries / header changes can't grow it unbounded.
    if len(_OG_CACHE) >= 256:
        _OG_CACHE.pop(next(iter(_OG_CACHE)))
    _OG_CACHE[etag] = data
    return data


def _absolutize(rel: str | None, base: str | None) -> str | None:
    """Make an app-relative URL absolute against ``public_base_url`` when it's set; otherwise leave
    it relative for the frontend to resolve via Next's ``metadataBase``."""
    if not rel or rel.startswith(("http://", "https://")) or not base:
        return rel
    return base.rstrip("/") + rel


def get_gallery_meta(
    db: Session, share_token: str, storage: StorageProvider
) -> GalleryMetaResponse:
    """Side-effect-free preview metadata for a share link (Open Graph / link unfurls).

    Unlike ``get_public_gallery`` this enqueues NO view notification and logs NO activity — a
    scraper fetching the link must not look like a client opening the gallery. Expired/unknown
    tokens 404 so the frontend falls back to the generic preview. Password-protected galleries
    expose their name but not the cover image."""
    gallery = gallery_repo.get_by_share_token(db, share_token)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    if gallery.expires_at:
        expires = gallery.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    app_settings = settings_repo.get(db)
    password_protected = gallery.password_hash is not None
    image_url = None
    if not password_protected and _meta_image_path(gallery, db, storage):
        # Point at the bounded og:image endpoint (not the raw header/cover), so WhatsApp's strict
        # image-size cap is always satisfied. See docs/architecture/.
        image_url = _absolutize(
            f"/api/public/g/{share_token}/og-image", app_settings.public_base_url
        )

    return GalleryMetaResponse(
        name=gallery.name,
        description=gallery.description or "",
        image_url=image_url,
        instance_name=app_settings.instance_name,
        password_protected=password_protected,
    )


def export_flagged(db: Session, gallery_id: str, flag: str | None = None, include_flag: bool = False) -> str:
    """Generate a plain-text export of flagged image filenames."""
    gallery = gallery_repo.get_by_id(db, gallery_id)
    if not gallery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Gallery not found")

    images = gallery_repo.get_flagged_images(db, gallery_id, flag=flag)
    lines = []
    for img in images:
        # Older rows may carry a folder path in original_filename (folder uploads); keep only the base.
        name = os.path.basename(img.original_filename)
        if include_flag:
            lines.append(f"{img.color_flag},{name}")
        else:
            lines.append(name)
    return "\n".join(lines)
