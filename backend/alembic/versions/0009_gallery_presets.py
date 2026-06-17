"""default gallery mode presets on app_settings

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL = built-in model defaults. Shape is enforced by the GalleryPreset schema at the API.
    op.add_column("app_settings", sa.Column("preset_presentation", sa.JSON(), nullable=True))
    op.add_column("app_settings", sa.Column("preset_collaboration", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("app_settings", "preset_collaboration")
    op.drop_column("app_settings", "preset_presentation")
