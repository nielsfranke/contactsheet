"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "galleries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("parent_id", sa.String(36), sa.ForeignKey("galleries.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=False, server_default=""),
        sa.Column("password_hash", sa.Text, nullable=True),
        sa.Column("share_token", sa.String(36), nullable=False, unique=True),
        sa.Column("mode", sa.String(20), nullable=False, server_default="presentation"),
        sa.Column("layout", sa.String(20), nullable=False, server_default="grid"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tags", sa.Text, nullable=False, server_default="[]"),
        sa.Column("watermark_settings", sa.Text, nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("downloads_enabled", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_galleries_parent_id", "galleries", ["parent_id"])
    op.create_index("ix_galleries_share_token", "galleries", ["share_token"], unique=True)
    op.create_index("ix_galleries_deleted_at", "galleries", ["deleted_at"])

    op.create_table(
        "images",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("gallery_id", sa.String(36), sa.ForeignKey("galleries.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("original_filename", sa.String(500), nullable=False),
        sa.Column("stored_filename", sa.String(100), nullable=False),
        sa.Column("width", sa.Integer, nullable=True),
        sa.Column("height", sa.Integer, nullable=True),
        sa.Column("file_size", sa.Integer, nullable=False),
        sa.Column("mime_type", sa.String(50), nullable=False),
        sa.Column("exif_data", sa.Text, nullable=True),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("color_flag", sa.String(10), nullable=False, server_default="none"),
        sa.Column("likes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tags", sa.Text, nullable=False, server_default="[]"),
        sa.Column("processing_status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_images_gallery_id", "images", ["gallery_id"])
    op.create_index("ix_images_deleted_at", "images", ["deleted_at"])
    op.create_index("ix_images_sort_order", "images", ["gallery_id", "sort_order"])


def downgrade() -> None:
    op.drop_table("images")
    op.drop_table("galleries")
