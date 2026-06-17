"""setup wizard columns

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("setup_complete", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("app_settings", sa.Column("admin_username", sa.String(255), nullable=True))
    op.add_column("app_settings", sa.Column("admin_password_hash", sa.String(255), nullable=True))
    op.add_column("app_settings", sa.Column("secret_key", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "secret_key")
    op.drop_column("app_settings", "admin_password_hash")
    op.drop_column("app_settings", "admin_username")
    op.drop_column("app_settings", "setup_complete")
