"""phase 2 — add comments table

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("images.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_comments_image_id", "comments", ["image_id"])


def downgrade() -> None:
    op.drop_table("comments")
