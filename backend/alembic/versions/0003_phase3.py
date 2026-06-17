"""phase 3 — annotations, voting, activities, app_settings, zip_jobs, gallery/image columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _add_column_if_missing(table: str, col_name: str, col) -> None:
    """Add column only if it doesn't already exist (SQLite has no IF NOT EXISTS for ALTER)."""
    from alembic import op as _op
    bind = _op.get_bind()
    existing = [row[1] for row in bind.execute(sa.text(f"PRAGMA table_info({table})"))]
    if col_name not in existing:
        _op.add_column(table, col)


def upgrade() -> None:
    # --- new columns on galleries ---
    _add_column_if_missing("galleries", "enable_team_voting",
                           sa.Column("enable_team_voting", sa.Boolean, nullable=False, server_default="0"))
    _add_column_if_missing("galleries", "headline",
                           sa.Column("headline", sa.Text, nullable=True))
    _add_column_if_missing("galleries", "header_image_filename",
                           sa.Column("header_image_filename", sa.String(255), nullable=True))

    # --- new columns on images ---
    _add_column_if_missing("images", "is_video",
                           sa.Column("is_video", sa.Boolean, nullable=False, server_default="0"))
    _add_column_if_missing("images", "video_poster_filename",
                           sa.Column("video_poster_filename", sa.String(255), nullable=True))

    # --- annotations ---
    op.create_table(
        "annotations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("images.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reviewer_name", sa.String(255), nullable=True),
        sa.Column("annotation_data", sa.Text, nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_annotations_image_id", "annotations", ["image_id"])

    # --- image_votes ---
    op.create_table(
        "image_votes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("images.id", ondelete="CASCADE"), nullable=False),
        sa.Column("gallery_id", sa.String(36), sa.ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reviewer_name", sa.String(255), nullable=False),
        sa.Column("color_flag", sa.String(10), nullable=False, server_default="none"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_image_votes_gallery", "image_votes", ["gallery_id"])

    # --- activities ---
    op.create_table(
        "activities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("gallery_id", sa.String(36), sa.ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("images.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(30), nullable=False),
        sa.Column("author", sa.String(255), nullable=False),
        sa.Column("meta", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_activities_gallery", "activities", ["gallery_id", "created_at"])

    # --- app_settings (singleton row id=1) ---
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("instance_name", sa.String(255), nullable=False, server_default="ContactSheet"),
        sa.Column("accent_color", sa.String(20), nullable=False, server_default="#3b82f6"),
        sa.Column("logo_filename", sa.String(255), nullable=True),
    )

    # --- zip_jobs ---
    op.create_table(
        "zip_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("gallery_id", sa.String(36), sa.ForeignKey("galleries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("filter_type", sa.String(20), nullable=False, server_default="all"),
        sa.Column("image_count", sa.Integer, nullable=True),
        sa.Column("file_path", sa.String(500), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_zip_jobs_gallery", "zip_jobs", ["gallery_id"])


def downgrade() -> None:
    op.drop_table("zip_jobs")
    op.drop_table("app_settings")
    op.drop_table("activities")
    op.drop_table("image_votes")
    op.drop_table("annotations")
    op.drop_column("images", "video_poster_filename")
    op.drop_column("images", "is_video")
    op.drop_column("galleries", "header_image_filename")
    op.drop_column("galleries", "headline")
    op.drop_column("galleries", "enable_team_voting")
