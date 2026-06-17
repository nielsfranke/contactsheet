# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""gallery sort defaults: gallery_sort/gallery_sort_dir + overview newest-first

Revision ID: 0033
Revises: 0032
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(
            sa.Column("gallery_sort", sa.String(length=12), nullable=False, server_default="captured")
        )
        batch.add_column(
            sa.Column("gallery_sort_dir", sa.String(length=4), nullable=False, server_default="asc")
        )
    # Overview now sorts by real date, newest-first. Flip the existing singleton from the old
    # default ("asc") so this instance picks it up; leave a deliberate "desc" untouched.
    op.execute("UPDATE app_settings SET overview_sort_dir = 'desc' WHERE overview_sort_dir = 'asc'")


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("gallery_sort_dir")
        batch.drop_column("gallery_sort")
