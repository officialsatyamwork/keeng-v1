"""billing, stock, and campaigns

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-16 13:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

invoice_status = postgresql.ENUM("unpaid", "paid", name="invoice_status", create_type=False)


def upgrade() -> None:
    op.add_column("services", sa.Column("gst_rate", sa.Numeric(5, 2), server_default="18", nullable=False))
    invoice_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("category", sa.String(60), nullable=False, server_default="General"),
        sa.Column("stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("min_stock", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("gst_rate", sa.Numeric(5, 2), nullable=False, server_default="18"),
        sa.Column("supplier", sa.String(120)),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_products_salon", "products", ["salon_id"])
    op.create_table(
        "invoices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("customer_id", sa.Uuid(), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), sa.ForeignKey("appointments.id", ondelete="SET NULL")),
        sa.Column("number", sa.String(20), nullable=False),
        sa.Column("status", invoice_status, nullable=False, server_default="unpaid"),
        sa.Column("pay_method", sa.String(20)),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False),
        sa.Column("discount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("gst", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(12, 2), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_invoices_salon_paid", "invoices", ["salon_id", "paid_at"])
    op.create_index(
        "uq_invoices_appointment",
        "invoices",
        ["appointment_id"],
        unique=True,
        postgresql_where=sa.text("appointment_id IS NOT NULL"),
    )
    op.create_table(
        "invoice_lines",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("invoice_id", sa.Uuid(), sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("gst_rate", sa.Numeric(5, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("service_id", sa.Uuid(), sa.ForeignKey("services.id", ondelete="SET NULL")),
        sa.Column("product_id", sa.Uuid(), sa.ForeignKey("products.id", ondelete="SET NULL")),
        sa.Column("staff_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.create_index("ix_invoice_lines_invoice_id", "invoice_lines", ["invoice_id"])
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("audience", sa.String(40), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_campaigns_salon_id", "campaigns", ["salon_id"])


def downgrade() -> None:
    op.drop_index("ix_campaigns_salon_id", table_name="campaigns")
    op.drop_table("campaigns")
    op.drop_index("ix_invoice_lines_invoice_id", table_name="invoice_lines")
    op.drop_table("invoice_lines")
    op.drop_index("uq_invoices_appointment", table_name="invoices")
    op.drop_index("ix_invoices_salon_paid", table_name="invoices")
    op.drop_table("invoices")
    op.drop_index("ix_products_salon", table_name="products")
    op.drop_table("products")
    invoice_status.drop(op.get_bind(), checkfirst=True)
    op.drop_column("services", "gst_rate")
