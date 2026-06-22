# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Separate lightbox filename toggle: galleries.show_filename_lightbox

Revision ID: 0036
Revises: 0035
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(
            sa.Column(
                "show_filename_lightbox",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("show_filename_lightbox")
