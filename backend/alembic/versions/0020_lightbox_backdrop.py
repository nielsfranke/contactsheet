# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add lightbox_backdrop to app_settings

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("lightbox_backdrop", sa.String(length=20), nullable=False, server_default="dimmed"))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("lightbox_backdrop")
