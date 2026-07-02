# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add lightbox zoom settings to app_settings

Revision ID: 0044
Revises: 0043
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("lightbox_zoom_enabled", sa.Boolean(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("lightbox_zoom_max", sa.String(length=10), nullable=False, server_default="400"))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("lightbox_zoom_max")
        batch.drop_column("lightbox_zoom_enabled")
