# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""image_likes: one like per reviewer per image

Revision ID: 0034
Revises: 0033
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_likes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("image_id", sa.String(length=36), nullable=False),
        sa.Column("gallery_id", sa.String(length=36), nullable=False),
        sa.Column("reviewer_name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["image_id"], ["images.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["gallery_id"], ["galleries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("image_id", "reviewer_name", name="uq_image_likes_image_reviewer"),
    )
    op.create_index("ix_image_likes_gallery_id", "image_likes", ["gallery_id"])


def downgrade() -> None:
    op.drop_index("ix_image_likes_gallery_id", table_name="image_likes")
    op.drop_table("image_likes")
