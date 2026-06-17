# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Annotations: rename scribbles_enabled -> annotations_enabled, add comments.anchor

Revision ID: 0027
Revises: 0026
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.alter_column("scribbles_enabled", new_column_name="annotations_enabled")
    with op.batch_alter_table("comments") as batch:
        batch.add_column(sa.Column("anchor", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("comments") as batch:
        batch.drop_column("anchor")
    with op.batch_alter_table("galleries") as batch:
        batch.alter_column("annotations_enabled", new_column_name="scribbles_enabled")
