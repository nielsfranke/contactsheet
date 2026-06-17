"""public base url setting + widen gallery share_token

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("public_base_url", sa.String(255), nullable=True))
    # Widen share_token so it can hold custom slugs (SQLite ignores the length, but keep the
    # schema honest for other backends). batch_alter_table is required on SQLite.
    with op.batch_alter_table("galleries") as batch:
        batch.alter_column("share_token", type_=sa.String(80), existing_type=sa.String(36))


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.alter_column("share_token", type_=sa.String(36), existing_type=sa.String(80))
    op.drop_column("app_settings", "public_base_url")
