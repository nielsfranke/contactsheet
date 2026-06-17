"""Add header_focus_x / header_focus_y to galleries

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(sa.Column("header_focus_x", sa.Float(), nullable=True, server_default="50"))
        batch.add_column(sa.Column("header_focus_y", sa.Float(), nullable=True, server_default="50"))


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("header_focus_y")
        batch.drop_column("header_focus_x")
