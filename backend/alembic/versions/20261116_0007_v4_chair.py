"""visit bills, chair rules, and staff payouts

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-16 14:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'in_service'")
    op.execute("ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'billed'")
    op.execute("ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'no_show'")
    op.add_column(
        "staff_profiles",
        sa.Column("product_commission_percent", sa.Numeric(5, 2), server_default="0", nullable=False),
    )
    op.create_table(
        "staff_services",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", sa.Uuid(), sa.ForeignKey("services.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("user_id", "service_id", name="uq_staff_services_user_service"),
    )
    op.create_table(
        "staff_breaks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
    )
    op.create_index("ix_staff_breaks_user_salon", "staff_breaks", ["user_id", "salon_id"])
    op.create_table(
        "staff_leave",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("note", sa.String(200)),
        sa.UniqueConstraint("user_id", "salon_id", "day", name="uq_staff_leave_day"),
    )
    op.create_table(
        "staff_payouts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("service_pay", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("product_pay", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="paid"),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "salon_id", "month", name="uq_staff_payout_month"),
    )


def downgrade() -> None:
    op.drop_table("staff_payouts")
    op.drop_table("staff_leave")
    op.drop_index("ix_staff_breaks_user_salon", table_name="staff_breaks")
    op.drop_table("staff_breaks")
    op.drop_table("staff_services")
    op.drop_column("staff_profiles", "product_commission_percent")
