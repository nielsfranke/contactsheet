# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Star ratings: app_settings.rating_mode + images.rating + image_votes.rating

Revision ID: 0039
Revises: 0038
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(
            sa.Column("rating_mode", sa.String(length=10), nullable=False, server_default="flags")
        )
    with op.batch_alter_table("images") as batch:
        batch.add_column(
            sa.Column("rating", sa.Integer(), nullable=False, server_default="0")
        )
    with op.batch_alter_table("image_votes") as batch:
        batch.add_column(
            sa.Column("rating", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("image_votes") as batch:
        batch.drop_column("rating")
    with op.batch_alter_table("images") as batch:
        batch.drop_column("rating")
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("rating_mode")
