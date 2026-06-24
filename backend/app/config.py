# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    secret_key: str | None = None
    admin_username: str = "admin"
    admin_password: str | None = None

    @field_validator("secret_key", "admin_password", mode="before")
    @classmethod
    def _empty_str_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v == "":
            return None
        return v

    db_url: str = "sqlite:////data/contactsheet.db"
    upload_dir: str = "/data/uploads"
    exports_dir: str = "/data/exports"
    branding_dir: str = "/data/branding"
    watermarks_dir: str = "/data/watermarks"
    zip_ttl_hours: int = 24
    max_video_bytes: int = 2_147_483_648   # 2 GB

    # Notification delivery hard wall-clock timeout (seconds) per channel send, so a slow/hung
    # target (internal or otherwise) can't tie up the test request or a flusher worker.
    notification_timeout: int = 10
    # Opt-in SSRF guard: when true, notification targets that resolve to a loopback/link-local/
    # private/reserved address are refused. Default OFF — self-hosters routinely point ntfy/SMTP
    # at a host on their own LAN, and that must keep working out of the box.
    block_internal_notification_targets: bool = False

    access_token_ttl: int = 86400       # 24h in seconds (default admin session)
    remember_token_ttl: int = 2592000   # 30d in seconds ("remember me" admin session)
    gallery_token_ttl: int = 43200      # 12h in seconds

    cookie_secure: bool = False

    # Number of *trusted* reverse-proxy hops in front of the app. The per-IP rate limiter and the
    # activity IP log derive the client address from `X-Forwarded-For` (XFF); since a client can
    # send an arbitrary XFF and the proxy only *appends* to it, the only non-spoofable entries are
    # the rightmost `trusted_proxy_hops` ones (added by our own proxies). The real client is the
    # entry `trusted_proxy_hops` positions from the right. Default 1 = the bundled nginx that ships
    # with the compose stack. Set to 2 when there's an extra proxy in front (e.g. Nginx Proxy
    # Manager → docker host → bundled nginx). 0 disables XFF trust entirely (app directly exposed).
    trusted_proxy_hops: int = 1

    thumb_size: int = 800
    medium_size: int = 2560
    # Worker threads that generate thumb/small/medium renditions after upload. Pillow releases the
    # GIL during resize/encode, so threads give real parallelism for batch uploads. Kept small so a
    # big drop can't saturate every core or pile up SQLite writers.
    image_workers: int = 3
    max_upload_bytes: int = 314_572_800  # 300 MB — headroom for large TIFF/PSD and RAW originals
    # Reject images whose pixel area exceeds this before decoding (decompression-bomb / giant-
    # dimension guard). Checked against the header dimensions, so a malicious file is refused
    # without ever allocating its full bitmap. 100 MP comfortably covers real cameras.
    max_image_pixels: int = 100_000_000

    # Gallery header/cover images are re-encoded to a bounded JPEG on store (not written raw): 3840 px
    # keeps a full-width banner sharp on 4K + Retina at a fraction of an unbounded original. They are
    # a single non-srcset <img>, so one size serves every screen.
    header_max_px: int = 3840
    header_quality: int = 82
    # Link-preview (Open Graph) image: small + universally accepted so WhatsApp (the only unfurler
    # with a strict ~600 KB–1 MB cap) renders the card. Derived on the fly from the header/cover/
    # first photo. See docs/architecture/header-cover-uploads-and-og-image-sizing.md.
    og_image_max_px: int = 1200
    og_image_quality: int = 80

    # Client (public) uploads get tighter caps than admin uploads: a smaller per-file size and a
    # per-request total, to bound attacker-controlled disk use on galleries with client upload on.
    client_upload_max_file_bytes: int = 26_214_400    # 25 MB per file
    client_upload_max_total_bytes: int = 262_144_000  # 250 MB per request
    # Stricter pixel ceiling for client (public) uploads than the admin limit above: a small,
    # highly-compressible file can still declare huge dimensions, and decoding it allocates
    # ~width*height*3 bytes. 50 MP bounds per-image decode memory on the attacker-reachable path
    # while comfortably covering phone/camera photos.
    client_upload_max_pixels: int = 50_000_000

    # Semantic search (optional). Inference runs in a separate `contactsheet-ml` sidecar so the
    # main backend image stays lean and the feature is opt-in at deploy time. The backend never
    # loads a model itself — it POSTs image paths / query text to this URL and stores the returned
    # vectors. Empty/None = no sidecar configured (search stays unavailable even if toggled on).
    ml_service_url: str | None = None
    # Per-request timeout (seconds) for sidecar calls. Image encodes are the slow side; a generous
    # ceiling keeps a busy sidecar from erroring spuriously without hanging the worker forever.
    ml_request_timeout: int = 60
    # Worker threads that push images to the sidecar for indexing. Kept low so backfill/indexing
    # never starves HTTP or the image-rendering pool on a modest CPU box.
    embed_workers: int = 2


settings = Settings()
