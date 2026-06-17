# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Configurable source-code URL: app_settings.source_url (AGPL §13)

Revision ID: 0035
Revises: 0034
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("source_url", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("source_url")
