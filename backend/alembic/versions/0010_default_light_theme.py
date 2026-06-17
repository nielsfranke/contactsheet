"""default admin theme to light

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-12

Changes the server-side default for app_settings.admin_theme from "dark" to
"light" for newly created instances. Existing rows are left untouched so a
deployment that explicitly chose dark keeps it.
"""
from alembic import op
import sqlalchemy as sa


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.alter_column(
            "admin_theme",
            existing_type=sa.String(10),
            server_default="light",
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.alter_column(
            "admin_theme",
            existing_type=sa.String(10),
            server_default="dark",
            existing_nullable=False,
        )
