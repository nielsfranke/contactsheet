# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add admin_locale to app_settings

Revision ID: 0024
Revises: 0023
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("admin_locale", sa.String(length=10), nullable=False, server_default="en"))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("admin_locale")
