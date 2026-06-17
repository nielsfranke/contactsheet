"""Add public branding footer to app_settings

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("footer_enabled", sa.Boolean(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("footer", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("footer")
        batch.drop_column("footer_enabled")
