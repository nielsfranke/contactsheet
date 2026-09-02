# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Make galleries.header_focus_x / header_focus_y NOT NULL (align schema with the model)

Revision ID: 0048
Revises: 0047
Create Date: 2026-09-02

Migration 0012 added the two focus columns as nullable (server_default "50") while the model has
always declared them NOT NULL with default 50.0 — the only drift between `alembic upgrade head`
and `Base.metadata`, found by tests/test_migrations_match_models.py. The ORM never writes NULL,
but a row inserted around it (a hand-edited DB, an older restore) could; backfill those to the
centre and tighten the constraint so the DB enforces what the code assumes.
"""
from alembic import op
import sqlalchemy as sa

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE galleries SET header_focus_x = 50 WHERE header_focus_x IS NULL")
    op.execute("UPDATE galleries SET header_focus_y = 50 WHERE header_focus_y IS NULL")
    with op.batch_alter_table("galleries") as batch:
        batch.alter_column("header_focus_x", existing_type=sa.Float(), nullable=False, existing_server_default="50")
        batch.alter_column("header_focus_y", existing_type=sa.Float(), nullable=False, existing_server_default="50")


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.alter_column("header_focus_x", existing_type=sa.Float(), nullable=True, existing_server_default="50")
        batch.alter_column("header_focus_y", existing_type=sa.Float(), nullable=True, existing_server_default="50")
