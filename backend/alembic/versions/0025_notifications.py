# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Notifications: app_settings.notifications, gallery.notifications_enabled, notification_outbox

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("notifications", sa.JSON(), nullable=True))
    with op.batch_alter_table("galleries") as batch:
        batch.add_column(
            sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default="1")
        )
    op.create_table(
        "notification_outbox",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("gallery_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("author", sa.String(length=255), nullable=True),
        sa.Column("meta", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["gallery_id"], ["galleries.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_notification_outbox_pending",
        "notification_outbox",
        ["sent_at", "gallery_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_notification_outbox_pending", table_name="notification_outbox")
    op.drop_table("notification_outbox")
    with op.batch_alter_table("galleries") as batch:
        batch.drop_column("notifications_enabled")
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("notifications")
