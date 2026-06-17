"""Add collections + collection_images (saved image selections)

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("gallery_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["gallery_id"], ["galleries.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_collections_gallery_id", "collections", ["gallery_id"])

    op.create_table(
        "collection_images",
        sa.Column("collection_id", sa.String(length=36), nullable=False),
        sa.Column("image_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["collection_id"], ["collections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["image_id"], ["images.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("collection_id", "image_id"),
    )


def downgrade() -> None:
    op.drop_table("collection_images")
    op.drop_index("ix_collections_gallery_id", table_name="collections")
    op.drop_table("collections")
