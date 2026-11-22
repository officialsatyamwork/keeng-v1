"""Request/response schemas. JSON uses camelCase to match the React frontend."""

import re
import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel

from app.models import Role, SalonStatus


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


def _phone(v: str | None) -> str | None:
    if v is None or v == "":
        return None
    digits = re.sub(r"[\s-]", "", v)
    if digits.startswith("+91"):
        digits = digits[3:]
    if not re.fullmatch(r"\d{10}", digits):
        raise ValueError("Enter a valid 10-digit phone number")
    return digits


def _gst(v: str | None) -> str | None:
    if v is None or v.strip() == "":
        return None
    v = v.strip().upper()
    if not re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]", v):
        raise ValueError("Enter a valid 15-character GSTIN")
    return v


def _lower_email(v: str) -> str:
    return v.strip().lower()


def _password(v: str) -> str:
    if not 8 <= len(v) <= 128:
        raise ValueError("Use 8 to 128 characters")
    if not re.search(r"[A-Z]", v):
        raise ValueError("Include one capital letter")
    if not re.search(r"[a-z]", v):
        raise ValueError("Include one small letter")
    if not re.search(r"\d", v):
        raise ValueError("Include one number")
    if not re.search(r"[^A-Za-z0-9]", v):
        raise ValueError("Include one special character")
    return v


Phone = Annotated[str, AfterValidator(_phone)]
OptPhone = Annotated[str | None, AfterValidator(_phone)]
Email = Annotated[EmailStr, AfterValidator(_lower_email)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Password = Annotated[str, AfterValidator(_password)]


# ---------- Auth ----------


class RegisterBusinessIn(Camel):
    name: Name
    email: Email
    phone: Phone
    business_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    business_type: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    city: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=80)] = None
    password: Password


def _dob(v: date | None) -> date | None:
    if v is None:
        return None
    today = datetime.now().date()
    if v > today:
        raise ValueError("Date of birth cannot be in the future")
    if today.year - v.year > 120:
        raise ValueError("Enter a real date of birth")
    return v


Dob = Annotated[date, AfterValidator(_dob)]
OptDob = Annotated[date | None, AfterValidator(_dob)]
LongText = Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=2000)]


class RegisterCustomerIn(Camel):
    name: Name
    email: Email
    phone: Phone
    password: Password
    date_of_birth: Dob
    allergies: LongText = None
    preferences: LongText = None


class LoginIn(Camel):
    """Sign in with an email or a phone number. The React form sends email only."""

    email: Email | None = None
    phone: OptPhone = None
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]

    @model_validator(mode="after")
    def one_identifier(self):
        if self.email and self.phone:
            raise ValueError("Enter either an email or a phone number")
        if not self.email and not self.phone:
            raise ValueError("Email or phone is required")
        return self


class ForgotPasswordIn(Camel):
    email: Email


class ResetPasswordIn(Camel):
    token: Annotated[str, StringConstraints(min_length=20, max_length=200)]
    password: Password


class ChangePasswordIn(Camel):
    current_password: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    new_password: Password


class TenantBrief(Camel):
    id: uuid.UUID
    name: str
    business_type: str
    trial_ends_at: datetime | None = None


class SalonBrief(Camel):
    id: uuid.UUID
    name: str
    city: str | None = None
    status: SalonStatus


class MeOut(Camel):
    id: uuid.UUID
    email: str
    full_name: str
    phone: str | None
    role: Role
    job_title: str | None
    tenant: TenantBrief | None
    salons: list[SalonBrief]
    modules: list[str]
    can_view_revenue: bool


class TokenOut(Camel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: MeOut


class LoginOut(Camel):
    """A code challenge. The session is issued only after the email code is confirmed."""

    two_factor_required: bool = False
    challenge_id: uuid.UUID | None = None
    message: str | None = None
    access_token: str | None = None
    token_type: Literal["bearer"] = "bearer"
    expires_in: int = 0
    user: MeOut | None = None


class LoginCodeIn(Camel):
    challenge_id: uuid.UUID
    code: Annotated[str, StringConstraints(pattern=r"^\d{6}$")]


class MessageOut(Camel):
    message: str


# ---------- Users ----------

AssignableRole = Literal["super_admin", "admin", "manager", "employee", "staff"]


class UserCreateIn(Camel):
    full_name: Name
    email: Email
    phone: OptPhone = None
    role: AssignableRole
    job_title: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=60)] = None
    salon_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class UserUpdateIn(Camel):
    full_name: Name | None = None
    phone: OptPhone = None
    job_title: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=60)] = None
    is_active: bool | None = None


class SalonIdsIn(Camel):
    salon_ids: list[uuid.UUID] = Field(max_length=200)


class UserOut(Camel):
    id: uuid.UUID
    email: str
    full_name: str
    phone: str | None
    role: Role
    job_title: str | None
    is_active: bool
    invite_pending: bool
    salon_ids: list[uuid.UUID]
    last_login_at: datetime | None
    created_at: datetime


class UserList(Camel):
    items: list[UserOut]
    total: int
    page: int
    page_size: int


# ---------- Salons ----------


class SalonCreateIn(Camel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    city: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    address: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    phone: Phone


class SalonUpdateIn(Camel):
    name: Annotated[str | None, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)] = None
    city: Annotated[str | None, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] = None
    address: Annotated[str | None, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)] = None
    phone: OptPhone = None
    status: SalonStatus | None = None


class SalonOut(Camel):
    id: uuid.UUID
    name: str
    city: str | None
    address: str | None
    phone: str | None
    status: SalonStatus
    staff: int = 0
    appointments: int = 0
    # Null for roles that may not see revenue (manager, staff).
    revenue: float | None = None
    created_at: datetime


class PublicSalonOut(Camel):
    id: uuid.UUID
    name: str
    city: str | None
    address: str | None
    phone: str | None
    business_name: str


# ---------- Settings ----------


class BusinessSettings(Camel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    type: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    email: Email | None = None
    phone: OptPhone = None
    address: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=500)] = None
    gst: Annotated[str | None, AfterValidator(_gst)] = None
    currency: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")] = "INR"
    timezone: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] = "Asia/Kolkata"


class NotificationPrefs(Camel):
    appointment_reminders: bool = True
    new_bookings: bool = True
    cancellations: bool = True
    low_stock: bool = True
    daily_summary: bool = False
    weekly_summary: bool = True


# ---------- Dashboard ----------


class Card(Camel):
    key: str
    label: str
    value: float | int | None
    format: Literal["currency", "number", "text"] = "number"
    hint: str | None = None


class ModuleCard(Camel):
    key: str
    label: str
    path: str
    description: str
    available: bool
    release: str


class DashboardOut(Camel):
    role: Role
    scope_label: str
    salon_id: uuid.UUID | None
    cards: list[Card]
    modules: list[ModuleCard]
    revenue_trend: list[dict] | None
    top_services: list[dict]
    today_appointments: list[dict]
    upcoming: list[dict]


# ---------- Bookings (V2) ----------


class ServiceIn(Camel):
    salon_id: uuid.UUID
    name: Name
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] = "General"
    duration_minutes: Annotated[int, Field(ge=5, le=480)]
    price: Annotated[float, Field(ge=0, le=10_000_000)]
    gst_rate: Annotated[float, Field(ge=0, le=28)] = 18
    is_active: bool = True


class ServicePatch(Camel):
    name: Name | None = None
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] | None = None
    duration_minutes: Annotated[int, Field(ge=5, le=480)] | None = None
    price: Annotated[float, Field(ge=0, le=10_000_000)] | None = None
    gst_rate: Annotated[float, Field(ge=0, le=28)] | None = None
    is_active: bool | None = None


class ServiceOut(Camel):
    id: uuid.UUID
    salon_id: uuid.UUID
    name: str
    category: str
    duration_minutes: int
    price: float
    gst_rate: float
    is_active: bool


class CustomerIn(Camel):
    salon_id: uuid.UUID
    full_name: Name
    phone: OptPhone = None
    email: Email | None = None
    notes: LongText = None
    date_of_birth: OptDob = None
    allergies: LongText = None
    preferences: LongText = None


class CustomerPatch(Camel):
    full_name: Name | None = None
    phone: OptPhone = None
    email: Email | None = None
    notes: LongText = None
    date_of_birth: OptDob = None
    allergies: LongText = None
    preferences: LongText = None
    share_across_branches: bool | None = None


class VisitBrief(Camel):
    id: uuid.UUID
    starts_at: datetime
    service_name: str
    staff_name: str | None
    status: str
    price: float
    notes: str | None
    salon_name: str


class CustomerOut(Camel):
    id: uuid.UUID
    salon_id: uuid.UUID
    full_name: str
    phone: str | None
    email: str | None
    notes: str | None
    date_of_birth: date | None
    allergies: str | None
    preferences: str | None
    loyalty_points: int
    visits: int = 0
    first_visit_at: datetime | None = None
    last_visit_at: datetime | None = None
    next_visit_at: datetime | None = None
    days_since_visit: int | None = None
    days_until_birthday: int | None = None
    birthday_soon: bool = False
    usual_staff: str | None = None
    due_back: bool = False
    share_across_branches: bool = True
    recent_visits: list[VisitBrief] = []


class MyProfileIn(Camel):
    date_of_birth: OptDob = None
    allergies: LongText = None
    preferences: LongText = None


class ShiftIn(Camel):
    weekday: Annotated[int, Field(ge=0, le=6)]
    start_time: Annotated[str, StringConstraints(pattern=r"^\d{2}:\d{2}$")]
    end_time: Annotated[str, StringConstraints(pattern=r"^\d{2}:\d{2}$")]


class ShiftOut(Camel):
    weekday: int
    start_time: str
    end_time: str


class StaffOut(Camel):
    user_id: uuid.UUID
    full_name: str
    job_title: str | None
    salon_id: uuid.UUID
    commission_percent: float | None = None
    product_commission_percent: float | None = None
    service_ids: list[uuid.UUID] = []
    shifts: list[ShiftOut] = []
    breaks: list[ShiftOut] = []
    leave: list["LeaveOut"] = []
    month_pay: float | None = None
    payout_status: str | None = None
    commission_kind: str | None = None
    slab_upto: float | None = None
    slab_percent: float | None = None
    slab_after_percent: float | None = None
    fixed_amount: float | None = None
    base_salary: float | None = None
    incentive: float | None = None
    advance: float | None = None
    service_pay: float | None = None
    product_pay: float | None = None
    salary_pay: float | None = None


class StaffPatch(Camel):
    commission_percent: Annotated[float, Field(ge=0, le=100)] | None = None
    product_commission_percent: Annotated[float, Field(ge=0, le=100)] | None = None
    commission_kind: Literal["percent", "slab", "fixed"] | None = None
    slab_upto: Annotated[float, Field(ge=0, le=10_000_000)] | None = None
    slab_percent: Annotated[float, Field(ge=0, le=100)] | None = None
    slab_after_percent: Annotated[float, Field(ge=0, le=100)] | None = None
    fixed_amount: Annotated[float, Field(ge=0, le=10_000_000)] | None = None
    base_salary: Annotated[float, Field(ge=0, le=10_000_000)] | None = None
    incentive: Annotated[float, Field(ge=0, le=10_000_000)] | None = None
    advance: Annotated[float, Field(ge=0, le=10_000_000)] | None = None


class SkillsPut(Camel):
    salon_id: uuid.UUID
    service_ids: list[uuid.UUID] = Field(max_length=40)


class BreaksPut(Camel):
    salon_id: uuid.UUID
    breaks: list[ShiftIn] = Field(max_length=21)


class LeaveIn(Camel):
    salon_id: uuid.UUID
    day: date
    note: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=200)] = None


class LeaveOut(Camel):
    id: uuid.UUID
    day: date
    note: str | None = None


class PayoutIn(Camel):
    salon_id: uuid.UUID
    month: Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}$")]


class ShiftsPut(Camel):
    salon_id: uuid.UUID
    shifts: list[ShiftIn] = Field(max_length=21)


class AppointmentIn(Camel):
    salon_id: uuid.UUID
    service_id: uuid.UUID
    starts_at: datetime
    staff_user_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    customer_name: Name | None = None
    customer_phone: OptPhone = None
    customer_email: Email | None = None
    source: Literal["desk", "online", "walk_in"] = "desk"
    notes: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=2000)] = None


class AppointmentPatch(Camel):
    starts_at: datetime | None = None
    staff_user_id: uuid.UUID | None = None
    status: Literal["booked", "confirmed", "checked_in", "in_service", "completed", "billed", "no_show", "cancelled"] | None = None
    notes: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None


class AppointmentOut(Camel):
    id: uuid.UUID
    salon_id: uuid.UUID
    salon_name: str
    customer_id: uuid.UUID
    customer_name: str
    customer_phone: str | None
    service_id: uuid.UUID
    service_name: str
    duration_minutes: int
    price: float
    staff_user_id: uuid.UUID | None
    staff_name: str | None
    starts_at: datetime
    ends_at: datetime
    status: str
    source: str
    notes: str | None


class SlotOut(Camel):
    starts_at: datetime
    label: str
    staff_user_id: uuid.UUID
    staff_name: str


class NoticeOut(Camel):
    id: str
    type: Literal["booking", "cancel", "change"]
    title: str
    body: str
    time: str
    group: str


class MyProfileOut(Camel):
    full_name: str
    email: str
    phone: str | None
    date_of_birth: date | None
    allergies: str | None
    preferences: str | None
    visits: list[AppointmentOut] = []


class PackageIn(Camel):
    salon_id: uuid.UUID
    name: Name
    sessions: Annotated[int, Field(ge=1, le=100)]
    price: Annotated[float, Field(ge=0, le=10_000_000)]
    validity_days: Annotated[int, Field(ge=1, le=730)] = 90


class PackageOut(Camel):
    id: uuid.UUID
    salon_id: uuid.UUID
    name: str
    sessions: int
    price: float
    validity_days: int
    is_active: bool


class SellPackageIn(Camel):
    customer_id: uuid.UUID
    package_id: uuid.UUID


class CustomerPackageOut(Camel):
    id: uuid.UUID
    customer_id: uuid.UUID
    customer_name: str
    package_id: uuid.UUID
    package_name: str
    sessions_total: int
    sessions_used: int
    expires_at: datetime
    status: str


# ---------- Billing, stock, campaigns (V3) ----------

Gst = Annotated[float, Field(ge=0, le=28)]


class ProductIn(Camel):
    salon_id: uuid.UUID
    name: Name
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] = "General"
    stock: Annotated[int, Field(ge=0, le=100_000)] = 0
    min_stock: Annotated[int, Field(ge=0, le=100_000)] = 5
    price: Annotated[float, Field(ge=0, le=10_000_000)]
    gst_rate: Gst = 18
    supplier: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=120)] = None


class ProductPatch(Camel):
    name: Name | None = None
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] | None = None
    stock: Annotated[int, Field(ge=0, le=100_000)] | None = None
    min_stock: Annotated[int, Field(ge=0, le=100_000)] | None = None
    price: Annotated[float, Field(ge=0, le=10_000_000)] | None = None
    gst_rate: Gst | None = None
    supplier: Annotated[str | None, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    is_active: bool | None = None


class ProductOut(Camel):
    id: uuid.UUID
    salon_id: uuid.UUID
    name: str
    category: str
    stock: int
    min_stock: int
    price: float
    gst_rate: float
    supplier: str | None
    is_active: bool
    low_stock: bool


class ShareIn(Camel):
    staff_user_id: uuid.UUID
    percent: Annotated[float, Field(gt=0, le=100)]


class InvoiceLineIn(Camel):
    kind: Literal["service", "product"]
    ref_id: uuid.UUID
    qty: Annotated[int, Field(ge=1, le=99)] = 1
    staff_user_id: uuid.UUID | None = None
    shares: list[ShareIn] = Field(default_factory=list, max_length=4)


class InvoiceIn(Camel):
    salon_id: uuid.UUID
    customer_id: uuid.UUID | None = None
    customer_name: Name | None = None
    customer_phone: OptPhone = None
    appointment_id: uuid.UUID | None = None
    discount_percent: Annotated[float, Field(ge=0, le=100)] = 0
    pay_now: bool = True
    pay_method: Literal["cash", "upi", "card"] | None = None
    staff_user_id: uuid.UUID | None = None
    lines: list[InvoiceLineIn] = Field(min_length=1, max_length=30)


class InvoiceLinesIn(Camel):
    lines: list[InvoiceLineIn] = Field(min_length=1, max_length=30)
    staff_user_id: uuid.UUID | None = None


class PayInvoiceIn(Camel):
    pay_method: Literal["cash", "upi", "card"]


class InvoiceLineOut(Camel):
    kind: str
    name: str
    qty: int
    unit_price: float
    gst_rate: float
    line_total: float
    staff_name: str | None = None


class InvoiceOut(Camel):
    id: uuid.UUID
    salon_id: uuid.UUID
    number: str
    customer_id: uuid.UUID
    customer_name: str
    appointment_id: uuid.UUID | None
    status: str
    pay_method: str | None
    subtotal: float
    discount: float
    gst: float
    total: float
    paid_at: datetime | None
    lines: list[InvoiceLineOut]


class CampaignIn(Camel):
    salon_id: uuid.UUID
    name: Name
    channel: Literal["whatsapp", "sms", "email"]
    audience: Literal["all", "birthday", "due", "recent"]
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class CampaignOut(Camel):
    id: uuid.UUID
    salon_id: uuid.UUID
    name: str
    channel: str
    audience: str
    message: str
    status: str
    recipient_count: int
    sent_at: datetime | None


class ReportPoint(Camel):
    name: str
    revenue: float


class ReportStaff(Camel):
    name: str
    appointments: int
    revenue: float


class ReportPay(Camel):
    name: str
    value: float


class ReportsOut(Camel):
    revenue_by_day: list[dict]
    services: list[ReportPoint]
    staff: list[ReportStaff]
    payments: list[ReportPay]
    revenue: float
    invoices: int
    customers: int
    appointments: int
