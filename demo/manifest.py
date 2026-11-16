# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Declarative description of the documentation-screenshot demo instance.

Single source of truth shared by `seed_demo.py` (which builds the instance via the REST API)
and `capture_screenshots.py` (which knows, by gallery key, what to photograph). Nothing here
touches the real instance — `seed_demo.py` runs it all against an isolated demo backend.
"""

from __future__ import annotations

# Demo admin credentials (password must be >= 8 chars). Throwaway — demo DB only.
ADMIN = {"username": "demo", "password": "aperture-demo-2024"}

# Instance branding (masthead shows name + tagline; no logo, so the login keeps the CS mark).
SETTINGS = {
    "instance_name": "Aperture Studio",
    "tagline": "Photography",
    "brand_display": "name_only",
    "accent_color": "#4f46e5",
    "accent_gradient": True,
    # Show colour flags and 1–5 stars side by side in the review screenshots.
    "rating_mode": "both",
    # Views only count (and the analytics view tiles only light up) with IP logging on.
    "activity_ip_logging": True,
    "footer_enabled": True,
    "footer": {
        "business_name": "Aperture Studio",
        "website_url": "https://aperture.studio",
        "email": "hello@aperture.studio",
        "instagram": "https://instagram.com/aperturestudio",
    },
}

# Reviewer identities used for the collaboration screenshot.
REVIEWERS = ["Mara Voss", "Jon Adler"]

# Galleries, in creation order. `assets` is a folder under demo/assets/. Top-level galleries
# may carry `children` (sub-galleries). `settings` is an optional PATCH applied after creation.
GALLERIES = [
    {
        "key": "iceland",
        "name": "Travel — Iceland",
        "mode": "presentation",
        "assets": "iceland",
        "headline": "Ring Road, late summer",
    },
    {
        "key": "sessions",
        "name": "Sessions 2024",
        "mode": "presentation",
        "children": [
            {"key": "studio", "name": "Studio", "mode": "presentation", "assets": "studio"},
            {"key": "location", "name": "On Location", "mode": "presentation", "assets": "location"},
        ],
    },
    {
        "key": "editorial",
        "name": "Editorial — Selects",
        "mode": "collaboration",
        "assets": "editorial",
        "settings": {
            "color_flags_enabled": True,
            "likes_enabled": True,
            "comments_enabled": True,
            "annotations_enabled": True,
        },
        # Collaboration content (references images by upload index). 3 comments total → matches
        # the comment badge on the gallery card.
        "collab": {
            "flags": {0: "green", 1: "red", 2: "yellow", 4: "green", 6: "blue"},
            "ratings": {0: 5, 1: 3, 2: 4, 3: 2, 4: 5, 5: 4},
            "likes": {"Mara Voss": [0, 2, 5], "Jon Adler": [0, 1, 3]},
            "comments": [
                {"image": 0, "author": "Mara Voss", "text": "Love the contrast here — this is the select."},
                {"image": 1, "author": "Jon Adler", "text": "Crop a touch tighter on the next pass?"},
                {"image": 2, "author": "Mara Voss", "text": "Final pick for the cover."},
            ],
            # Freehand annotations: (image index, author, text, [(x, y), ...] in 0..1 fractions).
            "annotations": [
                {
                    "image": 0, "author": "Jon Adler", "text": "Can we lift the shadows a little here?",
                    "ellipse": {"cx": 0.32, "cy": 0.62, "rx": 0.12, "ry": 0.09},
                },
            ],
        },
    },
    {
        "key": "coastal",
        "name": "Coastal Light",
        "mode": "presentation",
        "assets": "coastal",
        "headline": "Pacific coastline · winter light",
        # Use this uploaded photo (index) as the full-width hero banner behind the title.
        "header_image": 1,
    },
]

# Which gallery (by key) drives each screenshot scene. Resolved to ids/share_tokens at
# capture time from the runtime state file the seed writes.
SCENES = {
    "public_showcase": "coastal",      # 05 public gallery (big Showcase header)
    "lightbox": "coastal",             # 06 lightbox (first photo)
    "admin_gallery": "editorial",      # 04 admin gallery detail
    "edit_dialog": "editorial",        # 10 gallery settings modal
    "nested": "sessions",              # 08 public container with sub-gallery cover cards
    "collaboration": "editorial",      # 09 collaboration review
    "footer": "coastal",               # 11 public footer
    "mobile": "coastal",               # 12 mobile gallery
    "analytics": "editorial",          # 13 per-gallery analytics (+ 30 days of synthetic history)
    "review_lightbox": "editorial",    # 14 review lightbox: flags + stars, annotation, zoom
}

# Synthetic, backdated activity history so the analytics charts have a shape. Written straight
# into the demo DB after the API seed (the API only ever stamps "now"). Deterministic.
# 60 days so the 30-day window has a previous period to compare against (plausible trend %).
HISTORY_DAYS = 60
HISTORY_GALLERIES = ["editorial", "coastal", "iceland", "studio"]
HISTORY_REVIEWERS = REVIEWERS + ["Lena Brandt"]
# Galleries the photographer has "opened" since their last client activity (no "New" marker).
SEEN_GALLERIES = ["coastal", "iceland", "sessions", "studio", "location"]

# Uploaded file names: camera-style instead of the asset pool's 00.jpg, 01.jpg, …
FILENAME_PREFIX = {"editorial": "ED24_", "coastal": "CL_", "iceland": "ISL_", "studio": "STU_", "location": "LOC_"}
