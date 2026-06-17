"""gallery cover_image_id

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-12

Adds cover_image_id (nullable) to galleries so admins can pin a specific
image as the sub-gallery card thumbnail. Falls back to first image by
sort_order when null (existing behaviour).
"""
from alembic import op
import sqlalchemy as sa


revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(sa.Column("cover_image_id", sa.String(36), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("cover_image_id")
