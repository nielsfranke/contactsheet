# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Client upload of large files & working documents: galleries.client_upload_large_files

Revision ID: 0050
Revises: 0049
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        # Off by default: existing galleries keep the strict guest caps (JPEG/PNG/WebP, 25 MB, 50 MP).
        batch.add_column(
            sa.Column("client_upload_large_files", sa.Boolean(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("client_upload_large_files")
