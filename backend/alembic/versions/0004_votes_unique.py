"""add unique constraint on image_votes(image_id, reviewer_name)

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Deduplicate: keep the most recently updated vote per (image_id, reviewer_name)
    bind = op.get_bind()
    bind.execute(sa.text("""
        DELETE FROM image_votes
        WHERE id NOT IN (
            SELECT id FROM image_votes v1
            WHERE updated_at = (
                SELECT MAX(updated_at) FROM image_votes v2
                WHERE v2.image_id = v1.image_id
                  AND v2.reviewer_name = v1.reviewer_name
            )
        )
    """))
    op.create_index(
        "uq_image_votes_image_reviewer",
        "image_votes",
        ["image_id", "reviewer_name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_image_votes_image_reviewer", table_name="image_votes")
