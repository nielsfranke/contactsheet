"""admin theme setting

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("admin_theme", sa.String(10), nullable=False, server_default="dark"))


def downgrade() -> None:
    op.drop_column("app_settings", "admin_theme")
