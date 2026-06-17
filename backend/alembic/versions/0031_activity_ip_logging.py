# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Activity IP logging: activities.ip + app_settings IP-logging toggle & retention

Revision ID: 0031
Revises: 0030
Create Date: 2026-06-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("activities") as batch:
        batch.add_column(sa.Column("ip", sa.String(length=64), nullable=True))
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(
            sa.Column("activity_ip_logging", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("activity_ip_retention_days", sa.Integer(), nullable=False, server_default="90")
        )


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("activity_ip_retention_days")
        batch.drop_column("activity_ip_logging")
    with op.batch_alter_table("activities") as batch:
        batch.drop_column("ip")
