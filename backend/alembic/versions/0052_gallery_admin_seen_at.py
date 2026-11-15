# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Add galleries.admin_seen_at (when the photographer last opened the gallery — drives "new activity")

Revision ID: 0052
Revises: 0051
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(sa.Column("admin_seen_at", sa.DateTime(timezone=True), nullable=True))
    # Existing galleries count as seen at upgrade time: their pre-upgrade client activity is history,
    # not news — otherwise every older gallery would light up "New" at once and the marker would
    # mean nothing on day one. Galleries created afterwards start unseen (NULL).
    op.execute("UPDATE galleries SET admin_seen_at = CURRENT_TIMESTAMP")


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("admin_seen_at")
