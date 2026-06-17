# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Gallery cover upload: galleries.cover_image_filename

Revision ID: 0030
Revises: 0029
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(sa.Column("cover_image_filename", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("cover_image_filename")
