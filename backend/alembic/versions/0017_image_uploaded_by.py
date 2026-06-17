"""Add uploaded_by to images (client uploads)

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("images") as batch:
        batch.add_column(sa.Column("uploaded_by", sa.String(length=100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("images") as batch:
        batch.drop_column("uploaded_by")
