"""Add high_res_previews to app_settings

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("high_res_previews", sa.Boolean(), nullable=False, server_default="1"))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("high_res_previews")
