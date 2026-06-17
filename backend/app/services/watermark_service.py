# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import io
import logging
import os
import uuid

from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from app.config import settings
from app.schemas.watermark import WatermarkSettings

logger = logging.getLogger(__name__)

_SIZE_PCT = {"small": 0.15, "medium": 0.25, "large": 0.40}          # image: width fraction
_TEXT_PCT = {"small": 0.04, "medium": 0.06, "large": 0.09}          # text: short-edge fraction


def is_active(ws: dict | None) -> bool:
    """True when the (raw JSON) watermark settings describe an active watermark."""
    if not ws:
        return False
    try:
        return WatermarkSettings.model_validate(ws).is_active()
    except Exception:
        return False


def _paste_xy(base: tuple[int, int], wm: tuple[int, int], position: str, margin: int) -> tuple[int, int]:
    """Top-left paste coordinate for a watermark of size `wm` on a `base` image, in a 3×3 grid."""
    bw, bh = base
    ww, wh = wm
    cx = (bw - ww) // 2
    cy = (bh - wh) // 2
    left, right = margin, bw - ww - margin
    top, bottom = margin, bh - wh - margin
    xs = {"left": left, "center": cx, "right": right}
    ys = {"top": top, "center": cy, "bottom": bottom}

    if position == "center":
        return cx, cy
    vert, _, horiz = position.partition("-")
    return xs.get(horiz, right), ys.get(vert, bottom)


def _apply_image_watermark(base: PILImage.Image, ws: WatermarkSettings, gallery_id: str) -> PILImage.Image:
    wm_path = os.path.join(settings.watermarks_dir, gallery_id, ws.filename or "")
    if not ws.filename or not os.path.exists(wm_path):
        return base

    with PILImage.open(wm_path).convert("RGBA") as wm:
        bw, _bh = base.size
        target_w = int(bw * _SIZE_PCT.get(ws.size, 0.25))
        ratio = target_w / wm.width
        wm_resized = wm.resize((target_w, int(wm.height * ratio)), PILImage.LANCZOS)

    r, g, b, a = wm_resized.split()
    a = a.point(lambda x: int(x * ws.opacity / 100))
    wm_resized = PILImage.merge("RGBA", (r, g, b, a))

    margin = int(base.width * 0.02)
    base.paste(wm_resized, _paste_xy(base.size, wm_resized.size, ws.position, margin), wm_resized)
    return base


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def _apply_text_watermark(base: PILImage.Image, ws: WatermarkSettings) -> PILImage.Image:
    text = (ws.text or "").strip()
    if not text:
        return base

    bw, bh = base.size
    font_px = max(12, int(min(bw, bh) * _TEXT_PCT.get(ws.size, 0.06)))
    font = ImageFont.load_default(size=font_px)

    alpha = int(255 * ws.opacity / 100)
    r, g, b = _hex_to_rgb(ws.color)
    # Auto-contrast outline keeps text legible over light or dark photos.
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    outline = (0, 0, 0) if luma > 140 else (255, 255, 255)
    stroke = max(1, font_px // 20)

    # Render the text onto its own layer so opacity applies uniformly, then composite.
    layer = PILImage.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    margin = int(bw * 0.02)
    x, y = _paste_xy(base.size, (tw, th), ws.position, margin)
    # textbbox can have a nonzero origin; offset so the glyphs land at (x, y).
    draw.text((x - bbox[0], y - bbox[1]), text, font=font,
              fill=(r, g, b, alpha), stroke_width=stroke, stroke_fill=(*outline, alpha))

    return PILImage.alpha_composite(base, layer)


def apply_watermark(image_bytes: bytes, gallery_id: str, wm_settings: dict) -> bytes:
    """Composite the configured watermark onto image bytes in-memory, return JPEG bytes.

    Returns the input unchanged on any error (e.g. an SVG mark PIL can't open, a missing
    file) so the gallery never 500s on a bad watermark config.
    """
    try:
        ws = WatermarkSettings.model_validate(wm_settings)
        if not ws.is_active():
            return image_bytes

        with PILImage.open(io.BytesIO(image_bytes)).convert("RGBA") as base:
            composed = (
                _apply_text_watermark(base, ws)
                if ws.mode == "text"
                else _apply_image_watermark(base, ws, gallery_id)
            )
            out = composed.convert("RGB")

        buf = io.BytesIO()
        out.save(buf, format="JPEG", quality=88)
        return buf.getvalue()
    except Exception:
        logger.exception("Failed to apply watermark for gallery %s", gallery_id)
        return image_bytes


def save_watermark(gallery_id: str, data: bytes, original_ext: str) -> str:
    """Save uploaded watermark image, return stored filename."""
    dest_dir = os.path.join(settings.watermarks_dir, gallery_id)
    os.makedirs(dest_dir, exist_ok=True)
    filename = f"{uuid.uuid4()}{original_ext}"
    with open(os.path.join(dest_dir, filename), "wb") as f:
        f.write(data)
    return filename


def delete_watermark(gallery_id: str, filename: str) -> None:
    path = os.path.join(settings.watermarks_dir, gallery_id, filename)
    if os.path.exists(path):
        os.unlink(path)
