"""Database models for V1: tenants, users, salons, memberships and auth tokens.

Access model (from the V1 spec, plus the employee role):
- master_admin: owns a tenant (business) and sees every salon in it.
- super_admin:  one or more salons granted through `memberships`, including revenue.
- admin:        exactly one salon; full desk for that salon, including revenue.
- manager:      exactly one salon via `memberships`; never receives revenue.
- employee:     exactly one salon via `memberships`; front-desk work, never revenue.
- staff:        exactly one salon via `memberships`; own work and commission only.
- customer:     not tied to a tenant; browses every salon, sees own bookings.
"""

import enum
import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPk


class Role(str, enum.Enum):
    master_admin = "master_admin"
    super_admin = "super_admin"
    admin = "admin"
    manager = "manager"
    employee = "employee"
    staff = "staff"
    customer = "customer"


# Roles that belong to a business (tenant) and are scoped to salons.
TENANT_ROLES = {Role.master_admin, Role.super_admin, Role.admin, Role.manager, Role.employee, Role.staff}
# Roles limited to exactly one salon.
SINGLE_SALON_ROLES = {Role.admin, Role.manager, Role.employee, Role.staff}
# People counted on a salon's team (managers, front desk, stylists).
TEAM_ROLES = {Role.manager, Role.employee, Role.staff}
# Roles allowed to see revenue figures. Managers, employees and staff never are.
REVENUE_ROLES = {Role.master_admin, Role.super_admin, Role.admin}


class SalonStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"


class TokenPurpose(str, enum.Enum):
    password_reset = "password_reset"
    invite = "invite"


class AppointmentStatus(str, enum.Enum):
    booked = "booked"
    confirmed = "confirmed"
    checked_in = "checked_in"
    in_service = "in_service"
    completed = "completed"
    billed = "billed"
    no_show = "no_show"
    cancelled = "cancelled"


FINISHED = {AppointmentStatus.completed, AppointmentStatus.billed}


class AppointmentSource(str, enum.Enum):
    desk = "desk"
    online = "online"
    walk_in = "walk_in"


class PackageStatus(str, enum.Enum):
    active = "active"
    completed = "completed"
    expired = "expired"


def _enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x], native_enum=True)


DEFAULT_NOTIFICATION_PREFS = {
    "appointmentReminders": True,
    "newBookings": True,
    "cancellations": True,
    "lowStock": True,
    "dailySummary": False,
    "weeklySummary": True,
}


class Tenant(UUIDPk, Timestamps, Base):
    """A business account. One master_admin owns it; it holds one or more salons."""

    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(160))
    business_type: Mapped[str] = mapped_column(String(60), default="Salon")
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    gst_number: Mapped[str | None] = mapped_column(String(15))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    notification_prefs: Mapped[dict] = mapped_column(JSONB, default=lambda: dict(DEFAULT_NOTIFICATION_PREFS))
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    salons: Mapped[list["Salon"]] = relationship(back_populates="tenant")


class User(UUIDPk, Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (
        # Case-insensitive unique email.
        Index("uq_users_email_lower", func.lower(text("email")), unique=True),
        Index("ix_users_tenant_role", "tenant_id", "role"),
    )

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(254))
    # Unique so a phone number can sign in to exactly one account. NULL is allowed more than once.
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255))  # null until an invite is accepted
    role: Mapped[Role] = mapped_column(_enum(Role, "user_role"))
    job_title: Mapped[str | None] = mapped_column(String(60))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Bumped on password change / forced logout; access tokens carrying an older value are rejected.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    allergies: Mapped[str | None] = mapped_column(Text)
    preferences: Mapped[str | None] = mapped_column(Text)

    tenant: Mapped[Tenant | None] = relationship()
    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", foreign_keys="Membership.user_id"
    )


class Salon(UUIDPk, Timestamps, Base):
    """A physical branch. Belongs to one tenant."""

    __tablename__ = "salons"
    __table_args__ = (Index("ix_salons_tenant_status", "tenant_id", "status"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(160))
    city: Mapped[str | None] = mapped_column(String(80))
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[SalonStatus] = mapped_column(_enum(SalonStatus, "salon_status"), default=SalonStatus.active)

    tenant: Mapped[Tenant] = relationship(back_populates="salons")


class Membership(Base):
    """Links admins, managers, employees and staff to the salon(s) they may access."""

    __tablename__ = "memberships"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"), primary_key=True, index=True)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="memberships", foreign_keys=[user_id])
    salon: Mapped[Salon] = relationship()


class RefreshToken(UUIDPk, Base):
    """Rotating refresh tokens. Reuse of a rotated token revokes the whole family."""

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OneTimeToken(UUIDPk, Base):
    """Password-reset and invite tokens. Single use, short-lived; only the hash is stored."""

    __tablename__ = "one_time_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[TokenPurpose] = mapped_column(_enum(TokenPurpose, "token_purpose"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(UUIDPk, Base):
    """Who did what. Every access grant/revoke and user change is recorded."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_tenant_created", "tenant_id", "created_at"),)

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(64))
    meta: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Service(UUIDPk, Timestamps, Base):
    """A bookable service at one salon."""

    __tablename__ = "services"
    __table_args__ = (Index("ix_services_salon_active", "salon_id", "is_active"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(60), default="General")
    duration_minutes: Mapped[int] = mapped_column(Integer)
    price: Mapped[float] = mapped_column(Numeric(12, 2))
    gst_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=18)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Customer(UUIDPk, Timestamps, Base):
    """One person on the platform. Phone and email identify them across every salon."""

    __tablename__ = "customers"
    __table_args__ = (
        Index("ix_customers_salon", "salon_id"),
        Index("uq_customers_tenant_user", "tenant_id", "user_id", unique=True, postgresql_where=text("user_id IS NOT NULL")),
        Index("uq_customers_phone", "phone", unique=True, postgresql_where=text("phone IS NOT NULL")),
        Index("uq_customers_email", text("lower(email)"), unique=True, postgresql_where=text("email IS NOT NULL")),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(254))
    notes: Mapped[str | None] = mapped_column(Text)
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    allergies: Mapped[str | None] = mapped_column(Text)
    preferences: Mapped[str | None] = mapped_column(Text)
    loyalty_points: Mapped[int] = mapped_column(Integer, default=0)
    share_across_branches: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class StaffProfile(UUIDPk, Timestamps, Base):
    """Service and product commission for a staff or front-desk user."""

    __tablename__ = "staff_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    commission_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=10)
    product_commission_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    # percent: one rate. slab: a lower rate up to slab_upto, then a higher rate. fixed: rupees per service.
    commission_kind: Mapped[str] = mapped_column(String(20), default="percent", server_default="percent")
    slab_upto: Mapped[float] = mapped_column(Numeric(12, 2), default=50000, server_default="50000")
    slab_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=10, server_default="10")
    slab_after_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=15, server_default="15")
    fixed_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    base_salary: Mapped[float] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    incentive: Mapped[float] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    advance: Mapped[float] = mapped_column(Numeric(12, 2), default=0, server_default="0")


class Shift(UUIDPk, Base):
    """Weekly working hours for a person at one salon. weekday: 0 Monday .. 6 Sunday."""

    __tablename__ = "shifts"
    __table_args__ = (Index("ix_shifts_user_salon", "user_id", "salon_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)


class StaffService(UUIDPk, Base):
    """A service this person is allowed to perform. No rows means every service."""

    __tablename__ = "staff_services"
    __table_args__ = (Index("uq_staff_services_user_service", "user_id", "service_id", unique=True),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    service_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))


class StaffBreak(UUIDPk, Base):
    """A weekly break. weekday: 0 Monday .. 6 Sunday."""

    __tablename__ = "staff_breaks"
    __table_args__ = (Index("ix_staff_breaks_user_salon", "user_id", "salon_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)


class StaffLeave(UUIDPk, Base):
    """A full day off at one salon."""

    __tablename__ = "staff_leave"
    __table_args__ = (Index("uq_staff_leave_day", "user_id", "salon_id", "day", unique=True),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(200))


class StaffPayout(UUIDPk, Timestamps, Base):
    """The month's pay, marked paid by the owner. month is the first day of that month."""

    __tablename__ = "staff_payouts"
    __table_args__ = (Index("uq_staff_payout_month", "user_id", "salon_id", "month", unique=True),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    month: Mapped[date] = mapped_column(Date)
    service_pay: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    product_pay: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    total: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    status: Mapped[str] = mapped_column(String(20), default="paid")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Appointment(UUIDPk, Timestamps, Base):
    __tablename__ = "appointments"
    __table_args__ = (Index("ix_appointments_salon_start", "salon_id", "starts_at"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    service_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("services.id", ondelete="RESTRICT"))
    staff_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[AppointmentStatus] = mapped_column(
        _enum(AppointmentStatus, "appointment_status"), default=AppointmentStatus.booked
    )
    source: Mapped[AppointmentSource] = mapped_column(
        _enum(AppointmentSource, "appointment_source"), default=AppointmentSource.desk
    )
    notes: Mapped[str | None] = mapped_column(Text)


class Notice(UUIDPk, Timestamps, Base):
    """One bell item for one person. A booking change writes a row for each role that should see it."""

    __tablename__ = "notices"
    __table_args__ = (Index("ix_notices_user_created", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)


class Package(UUIDPk, Timestamps, Base):
    """A prepaid bundle of sessions sold by one salon."""

    __tablename__ = "packages"

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    sessions: Mapped[int] = mapped_column(Integer)
    price: Mapped[float] = mapped_column(Numeric(12, 2))
    validity_days: Mapped[int] = mapped_column(Integer, default=90)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class CustomerPackage(UUIDPk, Timestamps, Base):
    __tablename__ = "customer_packages"

    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    package_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("packages.id", ondelete="CASCADE"))
    sessions_total: Mapped[int] = mapped_column(Integer)
    sessions_used: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[PackageStatus] = mapped_column(_enum(PackageStatus, "package_status"), default=PackageStatus.active)


class InvoiceStatus(str, enum.Enum):
    unpaid = "unpaid"
    paid = "paid"


class Product(UUIDPk, Timestamps, Base):
    """Retail stock kept at one salon."""

    __tablename__ = "products"
    __table_args__ = (Index("ix_products_salon", "salon_id"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(60), default="General")
    stock: Mapped[int] = mapped_column(Integer, default=0)
    min_stock: Mapped[int] = mapped_column(Integer, default=5)
    price: Mapped[float] = mapped_column(Numeric(12, 2))
    gst_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=18)
    supplier: Mapped[str | None] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Invoice(UUIDPk, Timestamps, Base):
    """A GST bill. Revenue on the dashboard is the sum of paid invoices."""

    __tablename__ = "invoices"
    __table_args__ = (
        Index("ix_invoices_salon_paid", "salon_id", "paid_at"),
        Index("uq_invoices_appointment", "appointment_id", unique=True, postgresql_where=text("appointment_id IS NOT NULL")),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"))
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("appointments.id", ondelete="SET NULL"))
    number: Mapped[str] = mapped_column(String(20))
    status: Mapped[InvoiceStatus] = mapped_column(_enum(InvoiceStatus, "invoice_status"), default=InvoiceStatus.unpaid)
    pay_method: Mapped[str | None] = mapped_column(String(20))
    subtotal: Mapped[float] = mapped_column(Numeric(12, 2))
    discount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    gst: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    total: Mapped[float] = mapped_column(Numeric(12, 2))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InvoiceLine(UUIDPk, Base):
    __tablename__ = "invoice_lines"

    invoice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(160))
    qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2))
    gst_rate: Mapped[float] = mapped_column(Numeric(5, 2))
    line_total: Mapped[float] = mapped_column(Numeric(12, 2))
    service_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("services.id", ondelete="SET NULL"))
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    staff_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # [{"staffUserId": "...", "percent": 60}] when more than one stylist shares the line.
    splits: Mapped[list | None] = mapped_column(JSONB)


class LoginChallenge(UUIDPk, Base):
    """Email code for a master admin sign-in. The code itself is stored only as a hash."""

    __tablename__ = "login_challenges"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Campaign(UUIDPk, Timestamps, Base):
    """A saved reminder. Sending records who it is for; it does not call WhatsApp."""

    __tablename__ = "campaigns"

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    salon_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("salons.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    channel: Mapped[str] = mapped_column(String(20))
    audience: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


__all__ = [
    "AuditLog",
    "Base",
    "Membership",
    "OneTimeToken",
    "RefreshToken",
    "REVENUE_ROLES",
    "Role",
    "SINGLE_SALON_ROLES",
    "TEAM_ROLES",
    "Salon",
    "SalonStatus",
    "TENANT_ROLES",
    "Tenant",
    "TokenPurpose",
    "User",
]
