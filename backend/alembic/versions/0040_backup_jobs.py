# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Backup jobs: backup_jobs table (async full-instance backup builds)

Revision ID: 0040
Revises: 0039
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backup_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="pending"),
        sa.Column("scope", sa.String(length=10), nullable=False, server_default="full"),
        sa.Column("include_renditions", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("file_path", sa.String(length=500), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("backup_jobs")
