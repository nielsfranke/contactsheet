# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add overview_layout + overview_mosaic to app_settings (desktop overview view switch + folder mosaic covers)

Revision ID: 0051
Revises: 0050
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("overview_layout", sa.String(length=10), nullable=False, server_default="grid"))
        batch.add_column(sa.Column("overview_mosaic", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("overview_mosaic")
        batch.drop_column("overview_layout")
