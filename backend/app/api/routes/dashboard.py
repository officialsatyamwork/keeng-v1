"""Role-aware dashboard.

Appointment and customer cards read the booking tables. Revenue totals stay
at zero until billing exists, and are still omitted for managers and staff.
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.deps import DB, CurrentUser
from app.models import (
    FINISHED,
    TEAM_ROLES,
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    Customer,
    Membership,
    Role,
    Salon,
    SalonStatus,
    Service,
    User,
)
from app.schemas import Card, DashboardOut, ModuleCard
from app.services.access import MODULES, RELEASED, accessible_salon_ids, can_view_revenue, ensure_salon_access, modules_for
from app.services.customers import attach_login
from app.services.money import paid_total, revenue_by_day, staff_earnings, top_services, unpaid_total

KOLKATA = ZoneInfo("Asia/Kolkata")

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _module_cards(role: Role) -> list[ModuleCard]:
    out = []
    for key in modules_for(role):
        label, path, desc, release = MODULES[key]
        out.append(ModuleCard(key=key, label=label, path=path, description=desc, available=key in RELEASED, release=release))
    return out


async def _team_count(db: DB, salon_ids: list[uuid.UUID]) -> int:
    if not salon_ids:
        return 0
    return (
        await db.scalar(
            select(func.count(func.distinct(User.id)))
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.salon_id.in_(salon_ids), User.role.in_(TEAM_ROLES), User.is_active.is_(True))
        )
        or 0
    )


def _today_window() -> tuple[datetime, datetime]:
    now = datetime.now(KOLKATA)
    start = datetime.combine(now.date(), time.min, tzinfo=KOLKATA)
    return start, start + timedelta(days=1)


def _month_window() -> tuple[datetime, datetime]:
    now = datetime.now(KOLKATA)
    start = datetime(now.year, now.month, 1, tzinfo=KOLKATA)
    if now.month == 12:
        end = datetime(now.year + 1, 1, 1, tzinfo=KOLKATA)
    else:
        end = datetime(now.year, now.month + 1, 1, tzinfo=KOLKATA)
    return start, end


async def _count_appts(
    db: DB,
    salon_ids: list[uuid.UUID],
    start: datetime,
    end: datetime,
    *,
    staff_id: uuid.UUID | None = None,
    source: AppointmentSource | None = None,
    statuses: list[AppointmentStatus] | None = None,
) -> int:
    if not salon_ids and staff_id is None:
        return 0
    q = select(func.count()).select_from(Appointment).where(Appointment.starts_at >= start, Appointment.starts_at < end)
    if salon_ids:
        q = q.where(Appointment.salon_id.in_(salon_ids))
    if staff_id:
        q = q.where(Appointment.staff_user_id == staff_id)
    if source:
        q = q.where(Appointment.source == source)
    if statuses:
        q = q.where(Appointment.status.in_(statuses))
    else:
        q = q.where(Appointment.status != AppointmentStatus.cancelled)
    return await db.scalar(q) or 0


async def _commission(db: DB, user_id: uuid.UUID, salon_ids: list[uuid.UUID], start: datetime, end: datetime) -> float:
    _service, _product, total = await staff_earnings(db, user_id, salon_ids, start, end)
    return total


async def _today_rows(db: DB, salon_ids: list[uuid.UUID], start: datetime, end: datetime, *, staff_id=None, customer_user_id=None) -> list[dict]:
    staff = aliased(User)
    q = (
        select(Appointment, Customer.full_name, Service.name, staff.full_name, Salon.name)
        .join(Customer, Customer.id == Appointment.customer_id)
        .join(Service, Service.id == Appointment.service_id)
        .join(Salon, Salon.id == Appointment.salon_id)
        .outerjoin(staff, staff.id == Appointment.staff_user_id)
        .where(Appointment.status != AppointmentStatus.cancelled)
        .order_by(Appointment.starts_at)
        .limit(8)
    )
    if customer_user_id:
        q = q.where(
            Customer.user_id == customer_user_id,
            Appointment.starts_at >= datetime.now(UTC),
            Appointment.status.in_(
                [AppointmentStatus.booked, AppointmentStatus.confirmed, AppointmentStatus.checked_in, AppointmentStatus.in_service]
            ),
        )
    else:
        q = q.where(Appointment.starts_at >= start, Appointment.starts_at < end)
        if salon_ids:
            q = q.where(Appointment.salon_id.in_(salon_ids))
        if staff_id:
            q = q.where(Appointment.staff_user_id == staff_id)
    rows = (await db.execute(q)).all()
    out = []
    for appt, customer_name, service_name, staff_name, salon_name in rows:
        out.append(
            {
                "customer": customer_name,
                "service": service_name,
                "staff": staff_name or "Unassigned",
                "salon": salon_name,
                "time": appt.starts_at.astimezone(KOLKATA).strftime("%H:%M"),
                "status": appt.status.value,
            }
        )
    return out


@router.get("", response_model=DashboardOut)
async def dashboard(user: CurrentUser, db: DB, salon_id: uuid.UUID | None = Query(None, alias="salonId")) -> DashboardOut:
    modules = _module_cards(user.role)

    if user.role == Role.customer:
        await attach_login(db, user)
        salons_open = await db.scalar(select(func.count()).select_from(Salon).where(Salon.status == SalonStatus.active)) or 0
        upcoming = (
            await db.scalar(
                select(func.count())
                .select_from(Appointment)
                .join(Customer, Customer.id == Appointment.customer_id)
                .where(
                    Customer.user_id == user.id,
                    Appointment.starts_at >= datetime.now(UTC),
                    Appointment.status.in_(
                        [AppointmentStatus.booked, AppointmentStatus.confirmed, AppointmentStatus.checked_in, AppointmentStatus.in_service]
                    ),
                )
            )
            or 0
        )
        visits = (
            await db.scalar(
                select(func.count())
                .select_from(Appointment)
                .join(Customer, Customer.id == Appointment.customer_id)
                .where(Customer.user_id == user.id, Appointment.status.in_(FINISHED))
            )
            or 0
        )
        mine = await _today_rows(db, [], *_today_window(), customer_user_id=user.id)
        return DashboardOut(
            role=user.role,
            scope_label="My bookings",
            salon_id=None,
            modules=modules,
            cards=[
                Card(key="upcoming", label="Upcoming bookings", value=upcoming),
                Card(key="visits", label="Past visits", value=visits),
                Card(key="salons", label="Salons to book", value=salons_open),
            ],
            revenue_trend=None,
            top_services=[],
            today_appointments=mine,
            upcoming=mine,
        )

    if salon_id:
        salon = await ensure_salon_access(db, user, salon_id)
        scope_ids, scope_label = [salon.id], salon.name
    else:
        scope_ids = await accessible_salon_ids(db, user, include_inactive=False)
        scope_label = "All my salons" if len(scope_ids) != 1 else (await db.get(Salon, scope_ids[0])).name

    team = await _team_count(db, scope_ids)
    today_start, today_end = _today_window()
    month_start, month_end = _month_window()
    now = datetime.now(KOLKATA)
    staff_filter = user.id if user.role == Role.staff else None
    appointments_today = await _count_appts(db, scope_ids, today_start, today_end, staff_id=staff_filter)
    walk_ins = await _count_appts(db, scope_ids, today_start, today_end, source=AppointmentSource.walk_in)
    next7 = await _count_appts(db, scope_ids, now, now + timedelta(days=7), staff_id=staff_filter)
    served = await _count_appts(db, scope_ids, today_start, today_end, statuses=list(FINISHED))
    customer_count = (
        await db.scalar(select(func.count()).select_from(Customer).where(Customer.salon_id.in_(scope_ids))) or 0
        if scope_ids
        else 0
    )
    commission = await _commission(db, user.id, scope_ids, month_start, month_end) if user.role == Role.staff else 0
    revenue = await paid_total(db, scope_ids) if can_view_revenue(user) else 0
    pending = await unpaid_total(db, scope_ids) if can_view_revenue(user) else 0

    if user.role == Role.staff:
        cards = [
            Card(key="my_today", label="My appointments today", value=appointments_today),
            Card(key="commission", label="Pay this month", value=commission, format="currency"),
            Card(key="next7", label="Next 7 days", value=next7),
        ]
    elif user.role == Role.employee:
        cards = [
            Card(key="appointments_today", label="Appointments today", value=appointments_today),
            Card(key="walk_ins", label="Walk-ins today", value=walk_ins),
            Card(key="next7", label="Next 7 days", value=next7),
        ]
    elif user.role == Role.manager:
        cards = [
            Card(key="appointments_today", label="Appointments today", value=appointments_today),
            Card(key="walk_ins", label="Walk-ins today", value=walk_ins),
            Card(key="team", label="Staff on shift", value=team),
            Card(key="customers_today", label="Customers served", value=served),
        ]
    elif user.role == Role.admin:
        cards = [
            Card(key="revenue_today", label="This salon's revenue", value=revenue, format="currency"),
            Card(key="appointments_today", label="Bookings today", value=appointments_today),
            Card(key="customers", label="Salon customers", value=customer_count),
            Card(key="pending_payments", label="Unpaid bills", value=pending, format="currency"),
        ]
    elif user.role == Role.super_admin:
        cards = [
            Card(key="revenue_today", label="Revenue in my salons", value=revenue, format="currency"),
            Card(key="appointments_today", label="Appointments", value=appointments_today),
            Card(key="customers", label="Customers", value=customer_count),
            Card(key="salons", label="Salons assigned", value=len(scope_ids)),
            Card(key="team", label="Team", value=team),
        ]
    else:
        cards = [
            Card(key="salons", label="Salons in the network", value=len(scope_ids)),
            Card(key="revenue_today", label="Network revenue", value=revenue, format="currency"),
            Card(key="appointments_today", label="Appointments", value=appointments_today),
            Card(key="customers", label="Customers", value=customer_count),
            Card(key="pending_payments", label="Unpaid across salons", value=pending, format="currency"),
            Card(key="team", label="People", value=team),
        ]

    today_rows = await _today_rows(db, scope_ids, today_start, today_end, staff_id=staff_filter)
    return DashboardOut(
        role=user.role,
        scope_label=scope_label,
        salon_id=salon_id,
        cards=cards,
        modules=modules,
        revenue_trend=await revenue_by_day(db, scope_ids) if can_view_revenue(user) else None,
        top_services=await top_services(db, scope_ids) if can_view_revenue(user) else [],
        today_appointments=today_rows,
        upcoming=[],
    )
