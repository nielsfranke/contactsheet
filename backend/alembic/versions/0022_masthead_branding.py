# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add masthead branding fields to app_settings

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("brand_display", sa.String(length=20), nullable=False, server_default="logo_name"))
        batch.add_column(sa.Column("brand_font", sa.String(length=40), nullable=False, server_default="sans"))
        batch.add_column(sa.Column("brand_color", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("tagline", sa.String(length=120), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("tagline")
        batch.drop_column("brand_color")
        batch.drop_column("brand_font")
        batch.drop_column("brand_display")
