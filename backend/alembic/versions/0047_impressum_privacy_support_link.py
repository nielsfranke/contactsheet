# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add impressum, privacy and support_link_enabled to app_settings

Revision ID: 0047
Revises: 0046
Create Date: 2026-07-09

`support_link_enabled` is added with server_default "0" while the model declares default=True.
The disagreement is deliberate: this backfills the *existing* singleton row to False (an already
configured instance must not sprout an upstream donation link on upgrade), while a *fresh* install
migrates an empty table and then has settings_repo.get() INSERT the row with the model default
True. See docs/proposals/impressum-and-powered-by-strip.md.
"""
from alembic import op
import sqlalchemy as sa

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("impressum", sa.Text(), nullable=True))
        batch.add_column(sa.Column("privacy", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("support_link_enabled", sa.Boolean(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("support_link_enabled")
        batch.drop_column("privacy")
        batch.drop_column("impressum")
