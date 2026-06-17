"""Add hide_parent_nav (standalone access) to galleries

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(sa.Column("hide_parent_nav", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("hide_parent_nav")
