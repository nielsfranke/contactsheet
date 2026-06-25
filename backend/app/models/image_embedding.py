# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ImageEmbedding(Base):
    """One semantic-search vector per image (for the current model).

    The vector is the L2-normalized float32 image embedding produced by the configured
    vision-language encoder (SigLIP 2 base multilingual by default), packed as raw little-endian
    bytes. Stored normalized so a cosine ranking is a plain dot product at query time. `model`
    records the encoder name so a model swap can be detected and the row re-indexed.
    """

    __tablename__ = "image_embeddings"

    image_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("images.id", ondelete="CASCADE"), primary_key=True
    )
    model: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    dim: Mapped[int] = mapped_column(Integer, nullable=False)
    vector: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_now
    )
