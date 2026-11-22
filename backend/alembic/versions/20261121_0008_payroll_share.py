"""payroll plans, shared customers, bill splits, and master-admin sign-in codes

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-21 07:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "customers",
        sa.Column("share_across_branches", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.add_column("staff_profiles", sa.Column("commission_kind", sa.String(20), server_default="percent", nullable=False))
    op.add_column("staff_profiles", sa.Column("slab_upto", sa.Numeric(12, 2), server_default="50000", nullable=False))
    op.add_column("staff_profiles", sa.Column("slab_percent", sa.Numeric(5, 2), server_default="10", nullable=False))
    op.add_column("staff_profiles", sa.Column("slab_after_percent", sa.Numeric(5, 2), server_default="15", nullable=False))
    op.add_column("staff_profiles", sa.Column("fixed_amount", sa.Numeric(12, 2), server_default="0", nullable=False))
    op.add_column("staff_profiles", sa.Column("base_salary", sa.Numeric(12, 2), server_default="0", nullable=False))
    op.add_column("staff_profiles", sa.Column("incentive", sa.Numeric(12, 2), server_default="0", nullable=False))
    op.add_column("staff_profiles", sa.Column("advance", sa.Numeric(12, 2), server_default="0", nullable=False))
    op.add_column("invoice_lines", sa.Column("splits", postgresql.JSONB(), nullable=True))
    op.create_table(
        "login_challenges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_hash", sa.String(255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("used", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_login_challenges_user_id", "login_challenges", ["user_id"])
    # Visit bills already know the stylist. Older service lines left that blank, so pay stayed at zero.
    op.execute(
        """
        UPDATE invoice_lines AS line
        SET staff_user_id = appointment.staff_user_id
        FROM invoices AS invoice
        JOIN appointments AS appointment ON appointment.id = invoice.appointment_id
        WHERE line.invoice_id = invoice.id
          AND line.kind = 'service'
          AND line.staff_user_id IS NULL
          AND appointment.staff_user_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_login_challenges_user_id", table_name="login_challenges")
    op.drop_table("login_challenges")
    op.drop_column("invoice_lines", "splits")
    op.drop_column("staff_profiles", "advance")
    op.drop_column("staff_profiles", "incentive")
    op.drop_column("staff_profiles", "base_salary")
    op.drop_column("staff_profiles", "fixed_amount")
    op.drop_column("staff_profiles", "slab_after_percent")
    op.drop_column("staff_profiles", "slab_percent")
    op.drop_column("staff_profiles", "slab_upto")
    op.drop_column("staff_profiles", "commission_kind")
    op.drop_column("customers", "share_across_branches")
