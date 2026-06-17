# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""IPTC display: add images.iptc_data, drop galleries.contact_sheet_enabled

Revision ID: 0028
Revises: 0027
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("images") as batch:
        batch.add_column(sa.Column("iptc_data", sa.Text(), nullable=True))
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("contact_sheet_enabled")


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(
            sa.Column(
                "contact_sheet_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
    with op.batch_alter_table("images") as batch:
        batch.drop_column("iptc_data")
