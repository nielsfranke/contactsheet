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
        "headline": "Travel — Iceland",
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
        },
        # Collaboration content (references images by upload index). 3 comments total → matches
        # the comment badge on the gallery card.
        "collab": {
            "flags": {0: "green", 1: "red", 2: "yellow", 4: "green", 6: "blue"},
            "likes": {"Mara Voss": [0, 2, 5, 7], "Jon Adler": [0, 1, 3]},
            "comments": [
                {"image": 0, "author": "Mara Voss", "text": "Love the contrast here — this is the select."},
                {"image": 1, "author": "Jon Adler", "text": "Crop a touch tighter on the next pass?"},
                {"image": 2, "author": "Mara Voss", "text": "Final pick for the cover."},
            ],
        },
    },
    {
        "key": "coastal",
        "name": "Coastal Light",
        "mode": "presentation",
        "assets": "coastal",
        "headline": "Coastal Light",
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
}
