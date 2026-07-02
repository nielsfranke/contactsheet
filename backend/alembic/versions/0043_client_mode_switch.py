# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Client review-mode switch: galleries.client_mode_switch_enabled

Revision ID: 0043
Revises: 0042
Create Date: 2026-07-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        # Off by default: existing Showcase galleries stay view-only for clients.
        batch.add_column(
            sa.Column("client_mode_switch_enabled", sa.Boolean(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("client_mode_switch_enabled")
