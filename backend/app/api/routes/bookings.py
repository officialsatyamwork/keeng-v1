"""Services, customers, staff shifts, appointments, and packages.

Line prices are shown to whoever can open the appointment. Salon revenue
totals stay on the dashboard, and only for roles that already see revenue.
"""

import uuid
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from app.api.deps import DB, CurrentUser
from app.core.errors import Conflict, Forbidden, NotFound
from app.models import (
    FINISHED,
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    Customer,
    CustomerPackage,
    Membership,
    Notice,
    Package,
    PackageStatus,
    Role,
    Salon,
    SalonStatus,
    Service,
    Shift,
    StaffBreak,
    StaffLeave,
    StaffPayout,
    StaffProfile,
    StaffService,
    User,
)
from app.schemas import (
    AppointmentIn,
    AppointmentOut,
    AppointmentPatch,
    CustomerIn,
    CustomerOut,
    CustomerPackageOut,
    CustomerPatch,
    MyProfileIn,
    MyProfileOut,
    NoticeOut,
    VisitBrief,
    BreaksPut,
    LeaveIn,
    LeaveOut,
    PackageIn,
    PackageOut,
    PayoutIn,
    SellPackageIn,
    ServiceIn,
    ServiceOut,
    ServicePatch,
    ShiftIn,
    ShiftOut,
    ShiftsPut,
    SkillsPut,
    SlotOut,
    StaffOut,
    StaffPatch,
)
from app.services.access import accessible_salon_ids, ensure_salon_access, require_role
from app.services.customers import (
    attach_login,
    claim_account,
    duplicate_message,
    ensure_customer_access,
    find_customer,
    reuse_or_create,
    visible_to_salon,
)
from app.services.notices import announce_visit, visit_event

router = APIRouter(tags=["bookings"])

KOLKATA = ZoneInfo("Asia/Kolkata")
DESK = {Role.master_admin, Role.super_admin, Role.admin, Role.manager, Role.employee}
# Billing, services, stock, and staff pay belong to the salon desk, not the website owner.
CATALOGUE = {Role.admin, Role.manager, Role.employee}


def _money(value) -> float:
    return float(value or 0)


def _month_bounds(month: str | None = None) -> tuple[datetime, datetime]:
    if month:
        year, mon = (int(part) for part in month.split("-"))
        start_day = date(year, mon, 1)
    else:
        start_day = datetime.now(KOLKATA).date().replace(day=1)
    if start_day.month == 12:
        end_day = date(start_day.year + 1, 1, 1)
    else:
        end_day = date(start_day.year, start_day.month + 1, 1)
    return datetime.combine(start_day, time.min, tzinfo=KOLKATA), datetime.combine(end_day, time.min, tzinfo=KOLKATA)


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=KOLKATA)
    return value


def _clock(value: str) -> time:
    hour, minute = value.split(":")
    return time(int(hour), int(minute))


def _clock_out(value: time) -> str:
    return value.strftime("%H:%M")


async def _salon_for_read(db: DB, user: User, salon_id: uuid.UUID) -> Salon:
    if user.role == Role.customer:
        salon = await db.get(Salon, salon_id)
        if salon is None or salon.status != SalonStatus.active:
            raise NotFound("Salon not found")
        return salon
    return await ensure_salon_access(db, user, salon_id)


async def _service_out(row: Service) -> ServiceOut:
    return ServiceOut(
        id=row.id,
        salon_id=row.salon_id,
        name=row.name,
        category=row.category,
        duration_minutes=row.duration_minutes,
        price=_money(row.price),
        gst_rate=_money(row.gst_rate),
        is_active=row.is_active,
    )


def _appt_out(appt: Appointment, customer: Customer, service: Service, salon: Salon, staff: User | None) -> AppointmentOut:
    return AppointmentOut(
        id=appt.id,
        salon_id=appt.salon_id,
        salon_name=salon.name,
        customer_id=customer.id,
        customer_name=customer.full_name,
        customer_phone=customer.phone,
        service_id=service.id,
        service_name=service.name,
        duration_minutes=service.duration_minutes,
        price=_money(service.price),
        staff_user_id=appt.staff_user_id,
        staff_name=staff.full_name if staff else None,
        starts_at=appt.starts_at,
        ends_at=appt.ends_at,
        status=appt.status.value,
        source=appt.source.value,
        notes=appt.notes,
    )


async def _load_appt(db: DB, appt_id: uuid.UUID):
    staff = aliased(User)
    row = (
        await db.execute(
            select(Appointment, Customer, Service, Salon, staff)
            .join(Customer, Customer.id == Appointment.customer_id)
            .join(Service, Service.id == Appointment.service_id)
            .join(Salon, Salon.id == Appointment.salon_id)
            .outerjoin(staff, staff.id == Appointment.staff_user_id)
            .where(Appointment.id == appt_id)
        )
    ).one_or_none()
    if row is None:
        raise NotFound("Appointment not found")
    return row


async def _assert_staff(db: DB, salon: Salon, staff_id: uuid.UUID) -> User:
    person = await db.get(User, staff_id)
    member = await db.get(Membership, (staff_id, salon.id))
    if person is None or not person.is_active or person.role not in {Role.staff, Role.employee} or member is None:
        raise NotFound("Staff member not found")
    return person


async def _overlap(db: DB, staff_id: uuid.UUID, starts: datetime, ends: datetime, *, ignore: uuid.UUID | None = None) -> None:
    q = select(Appointment.id).where(
        Appointment.staff_user_id == staff_id,
        Appointment.status.notin_([AppointmentStatus.cancelled, AppointmentStatus.no_show]),
        Appointment.starts_at < ends,
        Appointment.ends_at > starts,
    )
    if ignore is not None:
        q = q.where(Appointment.id != ignore)
    if await db.scalar(q):
        raise Conflict("That person already has a booking at this time", code="staff_busy")


def _times_overlap(start: time, end: time, other_start: time, other_end: time) -> bool:
    return start < other_end and end > other_start


async def _assert_can_do(db: DB, staff_id: uuid.UUID, service_id: uuid.UUID) -> None:
    skills = (await db.scalars(select(StaffService.service_id).where(StaffService.user_id == staff_id))).all()
    if skills and service_id not in set(skills):
        raise Conflict("This stylist does not do that service", code="staff_skill")


async def _assert_available(db: DB, staff_id: uuid.UUID, salon_id: uuid.UUID, starts: datetime, ends: datetime) -> None:
    local_start = starts.astimezone(KOLKATA)
    local_end = ends.astimezone(KOLKATA)
    days = {local_start.date()}
    if local_end.date() != local_start.date() and local_end.time() != time.min:
        days.add(local_end.date())
    away = await db.scalar(
        select(StaffLeave.id).where(
            StaffLeave.user_id == staff_id,
            StaffLeave.salon_id == salon_id,
            StaffLeave.day.in_(days),
        )
    )
    if away:
        raise Conflict("This stylist is on leave that day", code="staff_leave")
    breaks = (
        await db.scalars(select(StaffBreak).where(StaffBreak.user_id == staff_id, StaffBreak.salon_id == salon_id))
    ).all()
    for row in breaks:
        if local_start.weekday() == row.weekday and local_start.date() == local_end.date():
            if _times_overlap(local_start.time(), local_end.time(), row.start_time, row.end_time):
                raise Conflict("This stylist is on a break then", code="staff_break")
    shifts = (
        await db.scalars(
            select(Shift).where(
                Shift.user_id == staff_id,
                Shift.salon_id == salon_id,
                Shift.weekday == local_start.weekday(),
            )
        )
    ).all()
    if shifts and local_start.date() == local_end.date():
        if not any(row.start_time <= local_start.time() and local_end.time() <= row.end_time for row in shifts):
            raise Conflict("That time is outside this stylist's shift", code="staff_shift")


def _copy_profile(target, source) -> None:
    target.date_of_birth = source.date_of_birth
    target.allergies = source.allergies
    target.preferences = source.preferences


async def _customer_for_login(db: DB, user: User, salon: Salon) -> Customer:
    linked = await db.scalar(select(Customer).where(Customer.user_id == user.id).order_by(Customer.created_at))
    if linked:
        _copy_profile(linked, user)
        return linked
    row = await reuse_or_create(
        db,
        salon,
        name=user.full_name,
        phone=user.phone,
        email=user.email,
        date_of_birth=user.date_of_birth,
        allergies=user.allergies,
        preferences=user.preferences,
        user_id=user.id,
    )
    if row.user_id == user.id:
        if row.date_of_birth is None:
            row.date_of_birth = user.date_of_birth
        if not row.allergies:
            row.allergies = user.allergies
        if not row.preferences:
            row.preferences = user.preferences
    return row


async def _apply_complete(db: DB, appt: Appointment) -> None:
    customer = await db.get(Customer, appt.customer_id)
    if customer is None:
        return
    customer.loyalty_points = (customer.loyalty_points or 0) + 1
    now = datetime.now(UTC)
    package = await db.scalar(
        select(CustomerPackage)
        .where(
            CustomerPackage.customer_id == customer.id,
            CustomerPackage.status == PackageStatus.active,
            CustomerPackage.expires_at > now,
            CustomerPackage.sessions_used < CustomerPackage.sessions_total,
        )
        .order_by(CustomerPackage.expires_at)
    )
    if package is None:
        return
    package.sessions_used += 1
    if package.sessions_used >= package.sessions_total:
        package.status = PackageStatus.completed


# ---------- Services ----------


@router.get("/services", response_model=list[ServiceOut])
async def list_services(user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> list[ServiceOut]:
    salon = await _salon_for_read(db, user, salon_id)
    q = select(Service).where(Service.salon_id == salon.id).order_by(Service.category, Service.name)
    if user.role == Role.customer:
        q = q.where(Service.is_active.is_(True))
    rows = (await db.scalars(q)).all()
    return [await _service_out(row) for row in rows]


@router.post("/services", response_model=ServiceOut, status_code=201)
async def create_service(body: ServiceIn, user: CurrentUser, db: DB) -> ServiceOut:
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    row = Service(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        name=body.name,
        category=body.category,
        duration_minutes=body.duration_minutes,
        price=body.price,
        gst_rate=body.gst_rate,
        is_active=body.is_active,
    )
    db.add(row)
    await db.flush()
    return await _service_out(row)


@router.patch("/services/{service_id}", response_model=ServiceOut)
async def update_service(service_id: uuid.UUID, body: ServicePatch, user: CurrentUser, db: DB) -> ServiceOut:
    require_role(user, *CATALOGUE)
    row = await db.get(Service, service_id)
    if row is None:
        raise NotFound("Service not found")
    await ensure_salon_access(db, user, row.salon_id)
    for field in ("name", "category", "duration_minutes", "price", "gst_rate", "is_active"):
        value = getattr(body, field)
        if value is not None:
            setattr(row, field, value)
    await db.flush()
    return await _service_out(row)


# ---------- Customers ----------


def _days_until_birthday(dob: date | None, today: date) -> int | None:
    if dob is None:
        return None

    def on(year: int) -> date:
        try:
            return dob.replace(year=year)
        except ValueError:
            return date(year, 2, 28)

    nxt = on(today.year)
    if nxt < today:
        nxt = on(today.year + 1)
    return (nxt - today).days


async def _customer_outs(db: DB, rows: list[Customer]) -> list[CustomerOut]:
    if not rows:
        return []
    staff = aliased(User)
    found = (
        await db.execute(
            select(Appointment, Service.name, Service.price, staff.full_name, Salon.name)
            .join(Service, Service.id == Appointment.service_id)
            .join(Salon, Salon.id == Appointment.salon_id)
            .outerjoin(staff, staff.id == Appointment.staff_user_id)
            .where(Appointment.customer_id.in_([row.id for row in rows]))
            .order_by(Appointment.starts_at)
        )
    ).all()
    grouped: dict[uuid.UUID, list] = defaultdict(list)
    for appt, service_name, price, staff_name, salon_name in found:
        grouped[appt.customer_id].append((appt, service_name, price, staff_name, salon_name))

    today = datetime.now(KOLKATA).date()
    now = datetime.now(UTC)
    open_status = {
        AppointmentStatus.booked,
        AppointmentStatus.confirmed,
        AppointmentStatus.checked_in,
        AppointmentStatus.in_service,
    }
    outs = []
    for row in rows:
        history = grouped.get(row.id, [])
        completed = [item for item in history if item[0].status in FINISHED]
        upcoming = [item for item in history if item[0].status in open_status and item[0].starts_at >= now]
        kept = [item for item in history if item[0].status != AppointmentStatus.cancelled]
        happened = [item for item in completed if item[0].starts_at.astimezone(UTC) <= now]
        last = happened[-1][0] if happened else None
        if last is None:
            days_since = None
        else:
            days_since = max(0, (today - last.starts_at.astimezone(KOLKATA).date()).days)
        staff_names = [name for _, _, _, name, _ in completed if name]
        usual = Counter(staff_names).most_common(1)[0][0] if staff_names else None
        until = _days_until_birthday(row.date_of_birth, today)
        recent = list(reversed(kept))[:3]
        outs.append(
            CustomerOut(
                id=row.id,
                salon_id=row.salon_id,
                full_name=row.full_name,
                phone=row.phone,
                email=row.email,
                notes=row.notes,
                date_of_birth=row.date_of_birth,
                allergies=row.allergies,
                preferences=row.preferences,
                loyalty_points=row.loyalty_points,
                visits=len(completed),
                first_visit_at=kept[0][0].starts_at if kept else None,
                last_visit_at=last.starts_at if last else None,
                next_visit_at=upcoming[0][0].starts_at if upcoming else None,
                days_since_visit=days_since,
                days_until_birthday=until,
                birthday_soon=until is not None and until <= 14,
                usual_staff=usual,
                due_back=days_since is not None and days_since >= 21 and not upcoming,
                share_across_branches=row.share_across_branches,
                recent_visits=[
                    VisitBrief(
                        id=appt.id,
                        starts_at=appt.starts_at,
                        service_name=service_name,
                        staff_name=staff_name,
                        status=appt.status.value,
                        price=_money(price),
                        notes=appt.notes,
                        salon_name=salon_name,
                    )
                    for appt, service_name, price, staff_name, salon_name in recent
                ],
            )
        )
    return outs


@router.get("/customers", response_model=list[CustomerOut])
async def list_customers(user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> list[CustomerOut]:
    require_role(user, *DESK, Role.staff)
    salon = await ensure_salon_access(db, user, salon_id)
    rows = (
        await db.scalars(
            select(Customer).where(visible_to_salon(salon)).order_by(Customer.full_name)
        )
    ).all()
    return await _customer_outs(db, list(rows))


@router.post("/customers", response_model=CustomerOut, status_code=201)
async def create_customer(body: CustomerIn, user: CurrentUser, db: DB) -> CustomerOut:
    require_role(user, *DESK)
    salon = await ensure_salon_access(db, user, body.salon_id)
    if not body.phone and not body.email:
        raise Conflict("Add a phone number or an email", code="contact_required")
    email = str(body.email).strip().lower() if body.email else None
    found = await find_customer(db, name=body.full_name, phone=body.phone, email=email)
    if found:
        raise Conflict(duplicate_message(found, phone=body.phone, email=email), code="customer_exists")
    row = await reuse_or_create(
        db,
        salon,
        name=body.full_name,
        phone=body.phone,
        email=email,
        notes=body.notes,
        date_of_birth=body.date_of_birth,
        allergies=body.allergies,
        preferences=body.preferences,
    )
    return (await _customer_outs(db, [row]))[0]


@router.patch("/customers/{customer_id}", response_model=CustomerOut)
async def update_customer(customer_id: uuid.UUID, body: CustomerPatch, user: CurrentUser, db: DB) -> CustomerOut:
    require_role(user, *DESK)
    row = await db.get(Customer, customer_id)
    if row is None:
        raise NotFound("Customer not found")
    await ensure_customer_access(db, user, row)
    data = body.model_dump(exclude_unset=True)
    next_phone = data["phone"] if "phone" in data else row.phone
    next_email = str(data["email"]).strip().lower() if data.get("email") else (None if "email" in data else row.email)
    next_name = data["full_name"] if "full_name" in data else row.full_name
    if "phone" in data and next_phone:
        taken = await db.scalar(select(Customer).where(Customer.phone == next_phone, Customer.id != row.id))
        if taken:
            raise Conflict(f"This phone already belongs to {taken.full_name}", code="customer_exists")
    if "email" in data and next_email:
        taken = await db.scalar(select(Customer).where(func.lower(Customer.email) == next_email, Customer.id != row.id))
        if taken:
            raise Conflict(f"This email already belongs to {taken.full_name}", code="customer_exists")
    if "full_name" in data and next_name:
        same_name = (
            await db.scalars(
                select(Customer).where(func.lower(Customer.full_name) == next_name.strip().lower(), Customer.id != row.id)
            )
        ).all()
        for other in same_name:
            if not next_phone or not other.phone or other.phone == next_phone:
                raise Conflict(f"{other.full_name} is already a customer. A second profile was not saved.", code="customer_exists")
    for field in ("full_name", "phone", "notes", "date_of_birth", "allergies", "preferences"):
        if field in data:
            setattr(row, field, data[field])
    if "email" in data and data["email"] is not None:
        row.email = next_email
    if "share_across_branches" in data and data["share_across_branches"] is not None:
        if user.role not in {Role.admin, Role.manager, Role.master_admin}:
            raise Forbidden("Only an admin can change whether this customer is shared")
        row.share_across_branches = data["share_across_branches"]
    if row.user_id and any(field in data for field in ("date_of_birth", "allergies", "preferences")):
        account = await db.get(User, row.user_id)
        if account is not None:
            _copy_profile(account, row)
    await claim_account(db, row)
    await db.flush()
    return (await _customer_outs(db, [row]))[0]


@router.get("/customers/{customer_id}/visits", response_model=list[AppointmentOut])
async def customer_visits(customer_id: uuid.UUID, user: CurrentUser, db: DB) -> list[AppointmentOut]:
    require_role(user, *DESK)
    row = await db.get(Customer, customer_id)
    if row is None:
        raise NotFound("Customer not found")
    await ensure_customer_access(db, user, row)
    staff = aliased(User)
    found = (
        await db.execute(
            select(Appointment, Customer, Service, Salon, staff)
            .join(Customer, Customer.id == Appointment.customer_id)
            .join(Service, Service.id == Appointment.service_id)
            .join(Salon, Salon.id == Appointment.salon_id)
            .outerjoin(staff, staff.id == Appointment.staff_user_id)
            .where(Appointment.customer_id == row.id)
            .order_by(Appointment.starts_at)
            .limit(200)
        )
    ).all()
    return [_appt_out(*item) for item in found]


@router.get("/me/profile", response_model=MyProfileOut)
async def my_profile(user: CurrentUser, db: DB) -> MyProfileOut:
    require_role(user, Role.customer)
    await attach_login(db, user)
    staff = aliased(User)
    found = (
        await db.execute(
            select(Appointment, Customer, Service, Salon, staff)
            .join(Customer, Customer.id == Appointment.customer_id)
            .join(Service, Service.id == Appointment.service_id)
            .join(Salon, Salon.id == Appointment.salon_id)
            .outerjoin(staff, staff.id == Appointment.staff_user_id)
            .where(Customer.user_id == user.id)
            .order_by(Appointment.starts_at)
            .limit(200)
        )
    ).all()
    return MyProfileOut(
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        date_of_birth=user.date_of_birth,
        allergies=user.allergies,
        preferences=user.preferences,
        visits=[_appt_out(*item) for item in found],
    )


@router.patch("/me/profile", response_model=MyProfileOut)
async def update_my_profile(body: MyProfileIn, user: CurrentUser, db: DB) -> MyProfileOut:
    require_role(user, Role.customer)
    data = body.model_dump(exclude_unset=True)
    for field in ("date_of_birth", "allergies", "preferences"):
        if field in data:
            setattr(user, field, data[field])
    linked = (await db.scalars(select(Customer).where(Customer.user_id == user.id))).all()
    for row in linked:
        _copy_profile(row, user)
    await db.flush()
    return await my_profile(user, db)


# ---------- Staff ----------


@router.get("/staff", response_model=list[StaffOut])
async def list_staff(user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> list[StaffOut]:
    salon = await _salon_for_read(db, user, salon_id)
    q = (
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.salon_id == salon.id,
            User.is_active.is_(True),
            User.role.in_([Role.staff, Role.employee]),
        )
        .order_by(User.full_name)
    )
    if user.role == Role.staff:
        q = q.where(User.id == user.id)
    people = (await db.scalars(q)).all()
    show_pay = user.role in CATALOGUE or user.role == Role.staff
    ids = [person.id for person in people]
    skills = (
        await db.execute(
            select(StaffService.user_id, StaffService.service_id)
            .join(Service, Service.id == StaffService.service_id)
            .where(StaffService.user_id.in_(ids or [uuid.uuid4()]), Service.salon_id == salon.id)
        )
    ).all() if ids else []
    skill_map: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for user_id, service_id in skills:
        skill_map[user_id].append(service_id)
    breaks = (
        await db.scalars(select(StaffBreak).where(StaffBreak.salon_id == salon.id, StaffBreak.user_id.in_(ids or [uuid.uuid4()])))
    ).all() if ids else []
    break_map: dict[uuid.UUID, list[StaffBreak]] = defaultdict(list)
    for row in breaks:
        break_map[row.user_id].append(row)
    today = datetime.now(KOLKATA).date()
    leaves = (
        await db.scalars(
            select(StaffLeave).where(
                StaffLeave.salon_id == salon.id,
                StaffLeave.user_id.in_(ids or [uuid.uuid4()]),
                StaffLeave.day >= today - timedelta(days=1),
            )
        )
    ).all() if ids else []
    leave_map: dict[uuid.UUID, list[StaffLeave]] = defaultdict(list)
    for row in leaves:
        leave_map[row.user_id].append(row)
    month_start, month_end = _month_bounds()
    out = []
    for person in people:
        profile = await db.scalar(select(StaffProfile).where(StaffProfile.user_id == person.id)) if show_pay else None
        percent = _money(profile.commission_percent) if profile else 10.0
        product_percent = _money(profile.product_commission_percent) if profile else 0.0
        shifts = (
            await db.scalars(select(Shift).where(Shift.user_id == person.id, Shift.salon_id == salon.id).order_by(Shift.weekday, Shift.start_time))
        ).all()
        month_pay = None
        payout_status = None
        payroll = None
        if show_pay and user.role != Role.customer:
            from app.services.money import month_payroll

            payroll = await month_payroll(db, person.id, salon.id, month_start, month_end)
            month_pay = payroll["total"]
            payout = await db.scalar(
                select(StaffPayout).where(
                    StaffPayout.user_id == person.id,
                    StaffPayout.salon_id == salon.id,
                    StaffPayout.month == month_start.date(),
                )
            )
            payout_status = payout.status if payout else "unpaid"
        out.append(
            StaffOut(
                user_id=person.id,
                full_name=person.full_name,
                job_title=person.job_title,
                salon_id=salon.id,
                commission_percent=percent if show_pay and user.role != Role.customer else None,
                product_commission_percent=product_percent if show_pay and user.role != Role.customer else None,
                service_ids=skill_map.get(person.id, []),
                shifts=[ShiftOut(weekday=s.weekday, start_time=_clock_out(s.start_time), end_time=_clock_out(s.end_time)) for s in shifts]
                if user.role != Role.customer
                else [],
                breaks=[
                    ShiftOut(weekday=row.weekday, start_time=_clock_out(row.start_time), end_time=_clock_out(row.end_time))
                    for row in sorted(break_map.get(person.id, []), key=lambda item: (item.weekday, item.start_time))
                ]
                if user.role != Role.customer
                else [],
                leave=[LeaveOut(id=row.id, day=row.day, note=row.note) for row in sorted(leave_map.get(person.id, []), key=lambda item: item.day)]
                if user.role != Role.customer
                else [],
                month_pay=month_pay,
                payout_status=payout_status,
                commission_kind=(profile.commission_kind if profile else "percent") if show_pay and user.role != Role.customer else None,
                slab_upto=_money(profile.slab_upto) if profile and show_pay else None,
                slab_percent=_money(profile.slab_percent) if profile and show_pay else None,
                slab_after_percent=_money(profile.slab_after_percent) if profile and show_pay else None,
                fixed_amount=_money(profile.fixed_amount) if profile and show_pay else None,
                base_salary=_money(profile.base_salary) if profile and show_pay else None,
                incentive=_money(profile.incentive) if profile and show_pay else None,
                advance=_money(profile.advance) if profile and show_pay else None,
                service_pay=payroll["service_pay"] if payroll else None,
                product_pay=payroll["product_pay"] if payroll else None,
                salary_pay=payroll["salary"] if payroll else None,
            )
        )
    return out


@router.patch("/staff/{user_id}", response_model=StaffOut)
async def update_staff(user_id: uuid.UUID, body: StaffPatch, user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> StaffOut:
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, salon_id)
    await _assert_staff(db, salon, user_id)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise Conflict("Enter a service or product percent", code="percent_required")
    profile = await db.scalar(select(StaffProfile).where(StaffProfile.user_id == user_id))
    if profile is None:
        profile = StaffProfile(user_id=user_id)
        db.add(profile)
    for field, value in data.items():
        if value is not None:
            setattr(profile, field, value)
    await db.flush()
    rows = await list_staff(user, db, salon.id)
    match = next((row for row in rows if row.user_id == user_id), None)
    if match is None:
        raise NotFound("Staff member not found")
    return match


@router.put("/staff/{user_id}/shifts", response_model=list[ShiftOut])
async def replace_shifts(user_id: uuid.UUID, body: ShiftsPut, user: CurrentUser, db: DB) -> list[ShiftOut]:
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    await _assert_staff(db, salon, user_id)
    existing = (await db.scalars(select(Shift).where(Shift.user_id == user_id, Shift.salon_id == salon.id))).all()
    for row in existing:
        await db.delete(row)
    saved = []
    for item in body.shifts:
        start, end = _clock(item.start_time), _clock(item.end_time)
        if end <= start:
            raise Conflict("Shift end must be after the start", code="bad_shift")
        row = Shift(user_id=user_id, salon_id=salon.id, weekday=item.weekday, start_time=start, end_time=end)
        db.add(row)
        saved.append(ShiftOut(weekday=item.weekday, start_time=item.start_time, end_time=item.end_time))
    await db.flush()
    return saved


@router.put("/staff/{user_id}/skills", response_model=StaffOut)
async def replace_skills(user_id: uuid.UUID, body: SkillsPut, user: CurrentUser, db: DB) -> StaffOut:
    """Empty means this person can do every service at the salon."""
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    await _assert_staff(db, salon, user_id)
    chosen = list(dict.fromkeys(body.service_ids))
    if chosen:
        found = (
            await db.scalars(select(Service.id).where(Service.salon_id == salon.id, Service.id.in_(chosen)))
        ).all()
        if set(found) != set(chosen):
            raise NotFound("Service not found")
    existing = (
        await db.scalars(
            select(StaffService)
            .join(Service, Service.id == StaffService.service_id)
            .where(StaffService.user_id == user_id, Service.salon_id == salon.id)
        )
    ).all()
    for row in existing:
        await db.delete(row)
    for service_id in chosen:
        db.add(StaffService(user_id=user_id, service_id=service_id))
    await db.flush()
    rows = await list_staff(user, db, salon.id)
    return next(row for row in rows if row.user_id == user_id)


@router.put("/staff/{user_id}/breaks", response_model=list[ShiftOut])
async def replace_breaks(user_id: uuid.UUID, body: BreaksPut, user: CurrentUser, db: DB) -> list[ShiftOut]:
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    await _assert_staff(db, salon, user_id)
    existing = (await db.scalars(select(StaffBreak).where(StaffBreak.user_id == user_id, StaffBreak.salon_id == salon.id))).all()
    for row in existing:
        await db.delete(row)
    saved = []
    for item in body.breaks:
        start, end = _clock(item.start_time), _clock(item.end_time)
        if end <= start:
            raise Conflict("Break end must be after the start", code="bad_break")
        db.add(StaffBreak(user_id=user_id, salon_id=salon.id, weekday=item.weekday, start_time=start, end_time=end))
        saved.append(ShiftOut(weekday=item.weekday, start_time=item.start_time, end_time=item.end_time))
    await db.flush()
    return saved


@router.post("/staff/{user_id}/leave", response_model=LeaveOut, status_code=201)
async def add_leave(user_id: uuid.UUID, body: LeaveIn, user: CurrentUser, db: DB) -> LeaveOut:
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    await _assert_staff(db, salon, user_id)
    existing = await db.scalar(
        select(StaffLeave).where(StaffLeave.user_id == user_id, StaffLeave.salon_id == salon.id, StaffLeave.day == body.day)
    )
    if existing:
        raise Conflict("This day is already leave", code="leave_exists")
    row = StaffLeave(user_id=user_id, salon_id=salon.id, day=body.day, note=body.note)
    db.add(row)
    await db.flush()
    return LeaveOut(id=row.id, day=row.day, note=row.note)


@router.delete("/staff/{user_id}/leave/{leave_id}", status_code=204)
async def delete_leave(user_id: uuid.UUID, leave_id: uuid.UUID, user: CurrentUser, db: DB) -> None:
    require_role(user, *CATALOGUE)
    row = await db.get(StaffLeave, leave_id)
    if row is None or row.user_id != user_id:
        raise NotFound("Leave not found")
    await ensure_salon_access(db, user, row.salon_id)
    await db.delete(row)
    await db.flush()


@router.post("/staff/{user_id}/payout", response_model=StaffOut)
async def pay_staff_month(user_id: uuid.UUID, body: PayoutIn, user: CurrentUser, db: DB) -> StaffOut:
    """Mark this month's service and product pay as paid out. The amount is what paid bills earned so far."""
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    await _assert_staff(db, salon, user_id)
    start, end = _month_bounds(body.month)
    existing = await db.scalar(
        select(StaffPayout).where(
            StaffPayout.user_id == user_id,
            StaffPayout.salon_id == salon.id,
            StaffPayout.month == start.date(),
        )
    )
    if existing and existing.status == "paid":
        raise Conflict("This month was already paid out", code="already_paid")
    from app.services.money import month_payroll

    payroll = await month_payroll(db, user_id, salon.id, start, end)
    service_pay, product_pay, total = payroll["service_pay"], payroll["product_pay"], payroll["total"]
    if existing is None:
        db.add(
            StaffPayout(
                user_id=user_id,
                salon_id=salon.id,
                month=start.date(),
                service_pay=service_pay,
                product_pay=product_pay,
                total=total,
                status="paid",
                paid_at=datetime.now(UTC),
            )
        )
    else:
        existing.service_pay = service_pay
        existing.product_pay = product_pay
        existing.total = total
        existing.status = "paid"
        existing.paid_at = datetime.now(UTC)
    await db.flush()
    rows = await list_staff(user, db, salon.id)
    return next(row for row in rows if row.user_id == user_id)


@router.get("/staff/{user_id}/payslip")
async def staff_payslip(
    user_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    salon_id: uuid.UUID = Query(alias="salonId"),
    month: str = Query(pattern=r"^\d{4}-\d{2}$"),
) -> Response:
    if user.role not in CATALOGUE and user.id != user_id:
        raise Forbidden("You do not have permission to do this")
    salon = await ensure_salon_access(db, user, salon_id)
    person = await _assert_staff(db, salon, user_id)
    from app.services.money import month_payroll, payslip_pdf

    start, end = _month_bounds(month)
    pay = await month_payroll(db, user_id, salon.id, start, end)
    lines = [
        f"Keeng payslip  {salon.name}",
        f"{person.full_name}  {month}",
        "",
        f"Days worked          {pay['attended']} of {pay['scheduled'] or 'salary only'}",
        f"Base salary          Rs {pay['salary']:.2f}",
        f"Service commission   Rs {pay['service_pay']:.2f}",
        f"Product commission   Rs {pay['product_pay']:.2f}",
        f"Incentive            Rs {pay['incentive']:.2f}",
        f"Advance              Rs {pay['advance']:.2f}",
        "",
        f"Pay this month       Rs {pay['total']:.2f}",
        "",
        "Commission uses paid bills only. GST is not included.",
        "Salary uses shifts minus leave. No shift means the full base salary.",
    ]
    return Response(
        content=payslip_pdf(lines),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="payslip-{month}.pdf"'},
    )


# ---------- Appointments ----------


@router.get("/appointments", response_model=list[AppointmentOut])
async def list_appointments(
    user: CurrentUser,
    db: DB,
    salon_id: uuid.UUID | None = Query(None, alias="salonId"),
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[AppointmentOut]:
    now = datetime.now(KOLKATA)
    window_start = _aware(start) if start else now - timedelta(days=1)
    window_end = _aware(end) if end else now + timedelta(days=30)
    staff = aliased(User)
    q = (
        select(Appointment, Customer, Service, Salon, staff)
        .join(Customer, Customer.id == Appointment.customer_id)
        .join(Service, Service.id == Appointment.service_id)
        .join(Salon, Salon.id == Appointment.salon_id)
        .outerjoin(staff, staff.id == Appointment.staff_user_id)
        .where(Appointment.starts_at < window_end, Appointment.ends_at > window_start)
        .order_by(Appointment.starts_at)
    )
    if user.role == Role.customer:
        await attach_login(db, user)
        q = q.where(Customer.user_id == user.id)
        if salon_id:
            q = q.where(Appointment.salon_id == salon_id)
    elif user.role == Role.staff:
        salon = await ensure_salon_access(db, user, salon_id) if salon_id else None
        q = q.where(Appointment.staff_user_id == user.id)
        if salon:
            q = q.where(Appointment.salon_id == salon.id)
    else:
        require_role(user, *DESK)
        if salon_id:
            salon = await ensure_salon_access(db, user, salon_id)
            q = q.where(Appointment.salon_id == salon.id)
        else:
            ids = await accessible_salon_ids(db, user, include_inactive=False)
            if not ids:
                return []
            q = q.where(Appointment.salon_id.in_(ids))
    rows = (await db.execute(q.limit(300))).all()
    return [_appt_out(*row) for row in rows]


@router.get("/appointments/slots", response_model=list[SlotOut])
async def appointment_slots(
    user: CurrentUser,
    db: DB,
    salon_id: uuid.UUID = Query(alias="salonId"),
    service_id: uuid.UUID = Query(alias="serviceId"),
    day: date = Query(),
    staff_user_id: uuid.UUID | None = Query(None, alias="staffUserId"),
) -> list[SlotOut]:
    """Open 15-minute starts: shift, minus breaks, leave, and bookings."""
    salon = await _salon_for_read(db, user, salon_id)
    service = await db.get(Service, service_id)
    if service is None or service.salon_id != salon.id or not service.is_active:
        raise NotFound("Service not found")
    if staff_user_id:
        people = [await _assert_staff(db, salon, staff_user_id)]
    else:
        people = (
            await db.scalars(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(
                    Membership.salon_id == salon.id,
                    User.is_active.is_(True),
                    User.role.in_([Role.staff, Role.employee]),
                )
                .order_by(User.full_name)
            )
        ).all()
    duration = timedelta(minutes=service.duration_minutes)
    found: list[SlotOut] = []
    seen: set[datetime] = set()
    for person in people:
        try:
            await _assert_can_do(db, person.id, service.id)
        except Conflict:
            continue
        shifts = (
            await db.scalars(
                select(Shift).where(Shift.user_id == person.id, Shift.salon_id == salon.id, Shift.weekday == day.weekday())
            )
        ).all()
        windows = [(row.start_time, row.end_time) for row in shifts] or [(time(10, 0), time(19, 0))]
        for open_at, close_at in windows:
            cursor = datetime.combine(day, open_at, tzinfo=KOLKATA)
            closing = datetime.combine(day, close_at, tzinfo=KOLKATA)
            while cursor + duration <= closing:
                if staff_user_id or cursor not in seen:
                    try:
                        await _assert_available(db, person.id, salon.id, cursor, cursor + duration)
                        await _overlap(db, person.id, cursor, cursor + duration)
                    except Conflict:
                        cursor += timedelta(minutes=15)
                        continue
                    if not staff_user_id:
                        seen.add(cursor)
                    found.append(
                        SlotOut(
                            starts_at=cursor,
                            label=cursor.strftime("%I:%M %p").lstrip("0"),
                            staff_user_id=person.id,
                            staff_name=person.full_name,
                        )
                    )
                cursor += timedelta(minutes=15)
    found.sort(key=lambda slot: (slot.starts_at, slot.staff_name))
    return found


@router.post("/appointments", response_model=AppointmentOut, status_code=201)
async def create_appointment(body: AppointmentIn, user: CurrentUser, db: DB) -> AppointmentOut:
    salon = await _salon_for_read(db, user, body.salon_id)
    if salon.status != SalonStatus.active:
        raise Conflict("This salon is not taking bookings", code="salon_inactive")
    service = await db.get(Service, body.service_id)
    if service is None or service.salon_id != salon.id or not service.is_active:
        raise NotFound("Service not found")
    starts = _aware(body.starts_at)
    ends = starts + timedelta(minutes=service.duration_minutes)
    if starts < datetime.now(UTC) - timedelta(minutes=5) and user.role == Role.customer:
        raise Conflict("Pick a time that has not already passed", code="time_passed")
    staff_id = body.staff_user_id
    if staff_id is None:
        raise Conflict("Choose who will do this service", code="staff_required")
    await _assert_staff(db, salon, staff_id)
    await _assert_can_do(db, staff_id, service.id)
    await _assert_available(db, staff_id, salon.id, starts, ends)
    await _overlap(db, staff_id, starts, ends)

    if user.role == Role.customer:
        customer = await _customer_for_login(db, user, salon)
        source = AppointmentSource.online
    else:
        require_role(user, *DESK, Role.staff)
        source = AppointmentSource(body.source)
        if body.customer_id:
            customer = await db.get(Customer, body.customer_id)
            if customer is None:
                raise NotFound("Customer not found")
        elif body.customer_name:
            customer = await reuse_or_create(
                db, salon, name=body.customer_name, phone=body.customer_phone, email=str(body.customer_email) if body.customer_email else None
            )
        else:
            raise Conflict("Choose a customer or enter a name", code="customer_required")
        await claim_account(db, customer)

    appt = Appointment(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        customer_id=customer.id,
        service_id=service.id,
        staff_user_id=staff_id,
        starts_at=starts,
        ends_at=ends,
        status=AppointmentStatus.booked,
        source=source,
        notes=body.notes,
    )
    db.add(appt)
    await db.flush()
    loaded = await _load_appt(db, appt.id)
    await announce_visit(
        db,
        salon=loaded[3],
        customer=loaded[1],
        service=loaded[2],
        staff=loaded[4],
        event="booked",
        when=loaded[0].starts_at,
    )
    return _appt_out(*loaded)


@router.patch("/appointments/{appointment_id}", response_model=AppointmentOut)
async def update_appointment(appointment_id: uuid.UUID, body: AppointmentPatch, user: CurrentUser, db: DB) -> AppointmentOut:
    locked = await db.scalar(select(Appointment).where(Appointment.id == appointment_id).with_for_update())
    if locked is None:
        raise NotFound("Appointment not found")
    appt, customer, service, salon, _staff = await _load_appt(db, appointment_id)
    previous = appt.status
    previous_start = appt.starts_at
    previous_staff = appt.staff_user_id

    if user.role == Role.customer:
        await attach_login(db, user)
        if customer.user_id != user.id:
            raise NotFound("Appointment not found")
        if body.status != "cancelled" or body.starts_at or body.staff_user_id or body.notes:
            raise Forbidden("You can cancel your own booking")
        if appt.status not in {AppointmentStatus.booked, AppointmentStatus.confirmed}:
            raise Conflict("This booking can no longer be cancelled", code="cannot_cancel")
        appt.status = AppointmentStatus.cancelled
    elif user.role == Role.staff:
        if appt.staff_user_id != user.id:
            raise NotFound("Appointment not found")
        if body.status is None or body.starts_at or body.staff_user_id is not None:
            raise Forbidden("You can update the status of your own bookings")
        appt.status = AppointmentStatus(body.status)
    else:
        require_role(user, *DESK)
        await ensure_salon_access(db, user, appt.salon_id)
        if body.notes is not None:
            appt.notes = body.notes
        if body.staff_user_id is not None:
            await _assert_staff(db, salon, body.staff_user_id)
            appt.staff_user_id = body.staff_user_id
        if body.starts_at is not None:
            appt.starts_at = _aware(body.starts_at)
            appt.ends_at = appt.starts_at + timedelta(minutes=service.duration_minutes)
        if body.status is not None and appt.status != AppointmentStatus(body.status):
            appt.status = AppointmentStatus(body.status)
        # Confirm, check-in, and the other status buttons keep the time that was already booked.
        if (body.starts_at is not None or body.staff_user_id is not None) and appt.staff_user_id and appt.status not in {
            AppointmentStatus.cancelled,
            AppointmentStatus.no_show,
        }:
            await _assert_can_do(db, appt.staff_user_id, appt.service_id)
            await _assert_available(db, appt.staff_user_id, appt.salon_id, appt.starts_at, appt.ends_at)
            await _overlap(db, appt.staff_user_id, appt.starts_at, appt.ends_at, ignore=appt.id)

    if previous not in FINISHED and appt.status in {AppointmentStatus.completed, AppointmentStatus.billed}:
        started = previous in {AppointmentStatus.checked_in, AppointmentStatus.in_service}
        if not started and appt.starts_at.astimezone(UTC) > datetime.now(UTC):
            raise Conflict("This visit has not started yet", code="too_early")
        await _apply_complete(db, appt)
        from app.api.routes.commerce import raise_visit_bill

        await raise_visit_bill(db, appt)
        appt.status = AppointmentStatus.billed
    await db.flush()
    loaded = await _load_appt(db, appt.id)
    event = visit_event(previous.value, previous_start, previous_staff, loaded[0])
    if event:
        await announce_visit(
            db,
            salon=loaded[3],
            customer=loaded[1],
            service=loaded[2],
            staff=loaded[4],
            event=event,
            when=loaded[0].starts_at,
            previous_staff_id=previous_staff,
        )
    return _appt_out(*loaded)


def _ago(moment: datetime) -> str:
    seconds = int((datetime.now(UTC) - moment.astimezone(UTC)).total_seconds())
    if seconds < 60:
        return "Just now"
    if seconds < 3600:
        minutes = max(1, seconds // 60)
        return f"{minutes} min ago"
    if seconds < 86400:
        hours = max(1, seconds // 3600)
        return f"{hours} hr ago"
    days = seconds // 86400
    return "Yesterday" if days == 1 else f"{days} days ago"


@router.get("/notifications", response_model=list[NoticeOut])
async def notifications(user: CurrentUser, db: DB) -> list[NoticeOut]:
    """Bell items for this login. Every role, including a customer, sees their own changes."""
    if user.role == Role.customer:
        await attach_login(db, user)
    today = datetime.now(KOLKATA).date()
    rows = (
        await db.scalars(select(Notice).where(Notice.user_id == user.id).order_by(Notice.created_at.desc()).limit(40))
    ).all()
    today_items: list[NoticeOut] = []
    earlier: list[NoticeOut] = []
    for row in rows:
        item = NoticeOut(
            id=str(row.id),
            type=row.kind if row.kind in {"booking", "cancel", "change"} else "change",
            title=row.title,
            body=row.body,
            time=_ago(row.created_at),
            group="Today" if row.created_at.astimezone(KOLKATA).date() == today else "Earlier",
        )
        if item.group == "Today":
            today_items.append(item)
        else:
            earlier.append(item)
    return today_items + earlier


# ---------- Packages ----------


@router.get("/packages", response_model=list[PackageOut])
async def list_packages(user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> list[PackageOut]:
    require_role(user, *DESK)
    salon = await ensure_salon_access(db, user, salon_id)
    rows = (await db.scalars(select(Package).where(Package.salon_id == salon.id).order_by(Package.name))).all()
    return [
        PackageOut(
            id=row.id,
            salon_id=row.salon_id,
            name=row.name,
            sessions=row.sessions,
            price=_money(row.price),
            validity_days=row.validity_days,
            is_active=row.is_active,
        )
        for row in rows
    ]


@router.post("/packages", response_model=PackageOut, status_code=201)
async def create_package(body: PackageIn, user: CurrentUser, db: DB) -> PackageOut:
    require_role(user, *CATALOGUE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    row = Package(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        name=body.name,
        sessions=body.sessions,
        price=body.price,
        validity_days=body.validity_days,
    )
    db.add(row)
    await db.flush()
    return PackageOut(
        id=row.id,
        salon_id=row.salon_id,
        name=row.name,
        sessions=row.sessions,
        price=_money(row.price),
        validity_days=row.validity_days,
        is_active=row.is_active,
    )


@router.get("/customer-packages", response_model=list[CustomerPackageOut])
async def list_customer_packages(
    user: CurrentUser, db: DB, salon_id: uuid.UUID | None = Query(None, alias="salonId")
) -> list[CustomerPackageOut]:
    q = (
        select(CustomerPackage, Customer, Package)
        .join(Customer, Customer.id == CustomerPackage.customer_id)
        .join(Package, Package.id == CustomerPackage.package_id)
        .order_by(CustomerPackage.created_at.desc())
    )
    if user.role == Role.customer:
        await attach_login(db, user)
        q = q.where(Customer.user_id == user.id)
    else:
        require_role(user, *DESK)
        if salon_id is None:
            raise Conflict("Choose a salon", code="salon_required")
        salon = await ensure_salon_access(db, user, salon_id)
        q = q.where(Customer.salon_id == salon.id)
    rows = (await db.execute(q.limit(200))).all()
    return [
        CustomerPackageOut(
            id=held.id,
            customer_id=customer.id,
            customer_name=customer.full_name,
            package_id=package.id,
            package_name=package.name,
            sessions_total=held.sessions_total,
            sessions_used=held.sessions_used,
            expires_at=held.expires_at,
            status=held.status.value,
        )
        for held, customer, package in rows
    ]


@router.post("/customer-packages", response_model=CustomerPackageOut, status_code=201)
async def sell_package(body: SellPackageIn, user: CurrentUser, db: DB) -> CustomerPackageOut:
    require_role(user, *DESK)
    customer = await db.get(Customer, body.customer_id)
    package = await db.get(Package, body.package_id)
    if customer is None or package is None or package.salon_id != customer.salon_id or not package.is_active:
        raise NotFound("Package not found")
    await ensure_salon_access(db, user, customer.salon_id)
    held = CustomerPackage(
        customer_id=customer.id,
        package_id=package.id,
        sessions_total=package.sessions,
        sessions_used=0,
        expires_at=datetime.now(UTC) + timedelta(days=package.validity_days),
        status=PackageStatus.active,
    )
    db.add(held)
    await db.flush()
    return CustomerPackageOut(
        id=held.id,
        customer_id=customer.id,
        customer_name=customer.full_name,
        package_id=package.id,
        package_name=package.name,
        sessions_total=held.sessions_total,
        sessions_used=0,
        expires_at=held.expires_at,
        status=held.status.value,
    )
