# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Render the instance's favicon / PWA app icons from its branding.

Resolution chain (see docs/architecture/branding-aware-favicon.md):
  1. uploaded logo  -> contain-fit onto the icon square
  2. else monogram  -> first letter of instance_name on brand/accent colour
  3. else the contact-sheet product default (drawn here)

Backend-rendered because the favicon must work pre-login on every surface and only the backend has
the DB + logo file + Pillow. Results are cached in-process keyed on a branding signature; the same
signature is the HTTP ETag, so a branding change invalidates browsers automatically.
"""

import hashlib
import io
import os

from PIL import Image, ImageDraw, ImageFont

from app.config import settings as app_config
from app.models.app_settings import AppSettings

# Contact-sheet default palette (instance-accent-independent product mark).
_BG = (10, 10, 11, 255)
_FRAME = (231, 229, 228, 255)
_ACCENT = (245, 158, 11, 255)

# Dark chrome fallback when no (valid) accent is configured.
_DARK = "#0a0a0b"

# kind -> (size, rounded, pad_frac)
_SPECS = {
    "favicon": (256, True, 0.16),
    "any192": (192, True, 0.18),
    "any512": (512, True, 0.18),
    "maskable": (512, False, 0.26),
    "apple": (180, False, 0.18),
}
_OPAQUE = {"apple", "maskable"}  # logo case gets a solid backdrop for these

_cache: dict[tuple[str, str], bytes] = {}


def _logo_path(s: AppSettings) -> str | None:
    if s.logo_filename:
        p = os.path.join(app_config.branding_dir, s.logo_filename)
        if os.path.exists(p):
            return p
    return None


def signature(s: AppSettings) -> str:
    lp = _logo_path(s)
    mtime = os.path.getmtime(lp) if lp else 0
    raw = f"{s.logo_filename}|{mtime}|{s.instance_name}|{s.accent_color}|{s.brand_color}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def _is_hex(value: str | None) -> bool:
    h = (value or "").lstrip("#")
    if len(h) != 6:
        return False
    try:
        int(h, 16)
        return True
    except ValueError:
        return False


def theme_color(s: AppSettings) -> str:
    """PWA manifest theme colour — the instance accent when it's a valid hex, else dark chrome."""
    return s.accent_color if _is_hex(s.accent_color) else _DARK


def _hex_rgb(value: str | None, default: tuple[int, int, int]) -> tuple[int, int, int]:
    h = (value or "").lstrip("#")
    if len(h) == 6:
        try:
            return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
        except ValueError:
            pass
    return default


def _contrast(bg: tuple[int, int, int]) -> tuple[int, int, int]:
    lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]
    return (0, 0, 0) if lum > 140 else (255, 255, 255)


def _bg_rect(d: ImageDraw.ImageDraw, size: int, rounded: bool, fill: tuple) -> None:
    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * 0.22), fill=fill)
    else:
        d.rectangle([0, 0, size - 1, size - 1], fill=fill)


def _draw_contact_sheet(size: int, rounded: bool, pad_frac: float) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    _bg_rect(d, size, rounded, _BG)
    pad = round(size * pad_frac)
    grid = size - 2 * pad
    gap = max(1, round(grid * 0.07))
    cell = (grid - 2 * gap) / 3.0
    radius = max(1, round(cell * 0.16))
    for row in range(3):
        for col in range(3):
            x0 = pad + col * (cell + gap)
            y0 = pad + row * (cell + gap)
            fill = _ACCENT if (row == 0 and col == 0) else _FRAME
            d.rounded_rectangle([x0, y0, x0 + cell, y0 + cell], radius=radius, fill=fill)
    return img


def _draw_monogram(letter: str, size: int, rounded: bool, bg: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    _bg_rect(d, size, rounded, bg + (255,))
    font = ImageFont.load_default(size=int(size * 0.6))
    bbox = d.textbbox((0, 0), letter, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1]
    d.text((x, y), letter, font=font, fill=_contrast(bg) + (255,))
    return img


def _draw_logo(path: str, size: int, rounded: bool, pad_frac: float, opaque: bool) -> Image.Image:
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if opaque:
        # apple/maskable dislike transparency — give the logo a solid white backdrop.
        _bg_rect(ImageDraw.Draw(base), size, rounded, (255, 255, 255, 255))
    logo = Image.open(path).convert("RGBA")
    pad = round(size * pad_frac)
    box = size - 2 * pad
    logo.thumbnail((box, box), Image.Resampling.LANCZOS)
    base.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    return base


def _monogram_letter(name: str) -> str:
    return next((c for c in (name or "") if c.isalnum()), "C").upper()


def render(s: AppSettings, kind: str) -> bytes:
    key = (signature(s), kind)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    size, rounded, pad = _SPECS[kind]
    opaque = kind in _OPAQUE
    lp = _logo_path(s)

    if lp:
        img = _draw_logo(lp, size, rounded, pad, opaque)
    elif (s.instance_name or "").strip().lower() != "contactsheet":
        bg = _hex_rgb(s.brand_color or s.accent_color, _BG[:3])
        img = _draw_monogram(_monogram_letter(s.instance_name), size, rounded, bg)
    else:
        img = _draw_contact_sheet(size, rounded, pad)

    buf = io.BytesIO()
    if kind == "favicon":
        img.save(buf, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    else:
        img.save(buf, format="PNG")
    data = buf.getvalue()
    _cache[key] = data
    return data
