"""Add overview_sort_dir on app_settings (overview/tree sort direction)

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("overview_sort_dir", sa.String(length=4), nullable=False, server_default="asc"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "overview_sort_dir")
