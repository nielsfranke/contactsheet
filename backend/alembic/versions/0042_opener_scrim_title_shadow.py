# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Showcase hero legibility: galleries.opener_scrim + galleries.opener_title_shadow

Revision ID: 0042
Revises: 0041
Create Date: 2026-07-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        # Existing galleries keep today's look: scrim on, no extra title shadow.
        batch.add_column(
            sa.Column("opener_scrim", sa.Boolean(), nullable=False, server_default="1")
        )
        batch.add_column(
            sa.Column("opener_title_shadow", sa.Boolean(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("opener_title_shadow")
        batch.drop_column("opener_scrim")
