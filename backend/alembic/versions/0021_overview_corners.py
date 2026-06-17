# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add overview_corners to app_settings

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("overview_corners", sa.String(length=10), nullable=False, server_default="round"))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("overview_corners")
