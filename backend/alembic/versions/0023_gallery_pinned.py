# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add pinned to galleries

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(sa.Column("pinned", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("pinned")
