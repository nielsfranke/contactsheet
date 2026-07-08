# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add per-mode sub-gallery presets to galleries

Revision ID: 0045
Revises: 0044
Create Date: 2026-07-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(sa.Column("subgallery_presets", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("subgallery_presets")
