"""services, customers, appointments, staff shifts, packages

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-16 09:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

appointment_status = postgresql.ENUM(
    "booked", "confirmed", "checked_in", "completed", "cancelled", name="appointment_status", create_type=False
)
appointment_source = postgresql.ENUM("desk", "online", "walk_in", name="appointment_source", create_type=False)
package_status = postgresql.ENUM("active", "completed", "expired", name="package_status", create_type=False)


def upgrade() -> None:
    appointment_status.create(op.get_bind(), checkfirst=True)
    appointment_source.create(op.get_bind(), checkfirst=True)
    package_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "services",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("category", sa.String(60), nullable=False, server_default="General"),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_services_salon_active", "services", ["salon_id", "is_active"])

    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("phone", sa.String(20)),
        sa.Column("email", sa.String(254)),
        sa.Column("notes", sa.Text()),
        sa.Column("loyalty_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_customers_salon", "customers", ["salon_id"])
    op.execute(
        "CREATE UNIQUE INDEX uq_customers_tenant_user ON customers (tenant_id, user_id) WHERE user_id IS NOT NULL"
    )

    op.create_table(
        "staff_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("commission_percent", sa.Numeric(5, 2), nullable=False, server_default="10"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "shifts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
    )
    op.create_index("ix_shifts_user_salon", "shifts", ["user_id", "salon_id"])

    op.create_table(
        "appointments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("customer_id", sa.Uuid(), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("service_id", sa.Uuid(), sa.ForeignKey("services.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("staff_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", appointment_status, nullable=False, server_default="booked"),
        sa.Column("source", appointment_source, nullable=False, server_default="desk"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_appointments_salon_start", "appointments", ["salon_id", "starts_at"])

    op.create_table(
        "packages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("salon_id", sa.Uuid(), sa.ForeignKey("salons.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("sessions", sa.Integer(), nullable=False),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("validity_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "customer_packages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("customer_id", sa.Uuid(), sa.ForeignKey("customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("package_id", sa.Uuid(), sa.ForeignKey("packages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sessions_total", sa.Integer(), nullable=False),
        sa.Column("sessions_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", package_status, nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_customer_packages_customer_id", "customer_packages", ["customer_id"])


def downgrade() -> None:
    op.drop_table("customer_packages")
    op.drop_table("packages")
    op.drop_index("ix_appointments_salon_start", table_name="appointments")
    op.drop_table("appointments")
    op.drop_index("ix_shifts_user_salon", table_name="shifts")
    op.drop_table("shifts")
    op.drop_table("staff_profiles")
    op.execute("DROP INDEX IF EXISTS uq_customers_tenant_user")
    op.drop_index("ix_customers_salon", table_name="customers")
    op.drop_table("customers")
    op.drop_index("ix_services_salon_active", table_name="services")
    op.drop_table("services")
    postgresql.ENUM(name="package_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="appointment_source").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="appointment_status").drop(op.get_bind(), checkfirst=True)
