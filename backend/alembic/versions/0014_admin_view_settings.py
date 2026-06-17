"""Add admin view settings (admin grid + gallery overview) to app_settings

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("admin_grid_mode", sa.String(length=10), nullable=False, server_default="mirror"))
        batch.add_column(sa.Column("admin_grid_view", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("overview_size", sa.String(length=10), nullable=False, server_default="medium"))
        batch.add_column(sa.Column("overview_shape", sa.String(length=10), nullable=False, server_default="square"))
        batch.add_column(sa.Column("overview_spacing", sa.String(length=10), nullable=False, server_default="medium"))
        batch.add_column(sa.Column("overview_sort", sa.String(length=20), nullable=False, server_default="created"))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("overview_sort")
        batch.drop_column("overview_spacing")
        batch.drop_column("overview_shape")
        batch.drop_column("overview_size")
        batch.drop_column("admin_grid_view")
        batch.drop_column("admin_grid_mode")
