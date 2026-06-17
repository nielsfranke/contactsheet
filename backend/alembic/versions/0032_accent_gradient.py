# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""accent_gradient on app_settings

Revision ID: 0032
Revises: 0031
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(
            sa.Column("accent_gradient", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("accent_gradient")
