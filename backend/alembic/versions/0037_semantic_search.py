# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Semantic search: image_embeddings + images.embedding_status + app_settings.semantic_search

Revision ID: 0037
Revises: 0036
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "image_embeddings",
        sa.Column(
            "image_id",
            sa.String(length=36),
            sa.ForeignKey("images.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Which encoder produced this vector. A model swap re-indexes; rows with the old model
        # name are stale and get overwritten as the backfill walks them.
        sa.Column("model", sa.String(length=64), nullable=False),
        sa.Column("dim", sa.Integer(), nullable=False),
        # L2-normalized float32 vector, packed little-endian. Cosine == dot product on read.
        sa.Column("vector", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_image_embeddings_model", "image_embeddings", ["model"])

    with op.batch_alter_table("images") as batch:
        # pending | indexed | skipped (video / unencodable) | error
        batch.add_column(
            sa.Column(
                "embedding_status", sa.String(length=10), nullable=False, server_default="pending"
            )
        )

    with op.batch_alter_table("app_settings") as batch:
        # Config blob (shape: schemas.settings.SemanticSearchSettings); None = unset/off.
        batch.add_column(sa.Column("semantic_search", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("semantic_search")
    with op.batch_alter_table("images") as batch:
        batch.drop_column("embedding_status")
    op.drop_index("ix_image_embeddings_model", table_name="image_embeddings")
    op.drop_table("image_embeddings")
