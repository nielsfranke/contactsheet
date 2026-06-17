"""per-gallery presentation & collaboration settings

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


# (column, type, default) — booleans use string server defaults for SQLite
_PRESENTATION = [
    ("opener_font", sa.String(40), "sans"),
    ("opener_font_size", sa.String(10), "medium"),
    ("preview_size", sa.String(10), "medium"),
    ("preview_spacing", sa.String(10), "medium"),
    ("preview_corners", sa.String(10), "round"),
    ("bg_brightness", sa.String(10), "dark"),
]

_BOOL_COLUMNS = [
    ("color_flags_enabled", "1"),
    ("likes_enabled", "0"),
    ("comments_enabled", "1"),
    ("scribbles_enabled", "0"),
    ("sets_enabled", "0"),
    ("client_upload_enabled", "0"),
    ("show_filename", "0"),
    ("show_exif", "0"),
    ("show_iptc", "0"),
    ("contact_sheet_enabled", "0"),
]


def upgrade() -> None:
    for name, type_, default in _PRESENTATION:
        op.add_column("galleries", sa.Column(name, type_, nullable=False, server_default=default))
    op.add_column("galleries", sa.Column("bg_dimmed_color", sa.String(20), nullable=True))
    for name, default in _BOOL_COLUMNS:
        op.add_column("galleries", sa.Column(name, sa.Boolean(), nullable=False, server_default=default))


def downgrade() -> None:
    for name, _ in _BOOL_COLUMNS:
        op.drop_column("galleries", name)
    op.drop_column("galleries", "bg_dimmed_color")
    for name, _type, _default in _PRESENTATION:
        op.drop_column("galleries", name)
