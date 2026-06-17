# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Client upload moderation: images.moderation_status + galleries.client_upload_moderation

Revision ID: 0029
Revises: 0028
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("images") as batch:
        batch.add_column(
            sa.Column(
                "moderation_status",
                sa.String(length=10),
                nullable=False,
                server_default="approved",
            )
        )
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(
            sa.Column(
                "client_upload_moderation",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("client_upload_moderation")
    with op.batch_alter_table("images") as batch:
        batch.drop_column("moderation_status")
