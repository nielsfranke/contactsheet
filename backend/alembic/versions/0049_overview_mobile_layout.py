# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add overview_mobile_layout to app_settings (grid | list for the admin gallery overview on phones)

Revision ID: 0049
Revises: 0048
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("overview_mobile_layout", sa.String(length=10), nullable=False, server_default="grid"))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("overview_mobile_layout")
