# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Opener title position: galleries.opener_title_position

Revision ID: 0038
Revises: 0037
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(
            sa.Column(
                "opener_title_position",
                sa.String(length=20),
                nullable=False,
                server_default="center",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("opener_title_position")
