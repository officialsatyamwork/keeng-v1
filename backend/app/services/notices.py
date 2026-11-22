"""Bell items and confirmation email for a salon change.

Every active member of the salon, the business owner, the stylist, and the
customer each get a bell item. Confirmation email goes to the customer whenever
we have an address. The salon team gets that email when their notification
settings allow it.
"""

import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

from app.models import (
    DEFAULT_NOTIFICATION_PREFS,
    Appointment,
    AppointmentStatus,
    Customer,
    Membership,
    Notice,
    Role,
    Salon,
    Service,
    Tenant,
    User,
)
from app.services.email import send_email

KOLKATA = ZoneInfo("Asia/Kolkata")
_mail_tasks: set[asyncio.Task] = set()

# kind, title, whether this event also sends email
EVENTS = {
    "booked": ("booking", "Booking confirmed", True),
    "confirmed": ("booking", "Booking confirmed", True),
    "checked_in": ("change", "Checked in", False),
    "in_service": ("change", "Service started", False),
    "billed": ("change", "Visit completed", True),
    "no_show": ("change", "Marked as no-show", True),
    "cancelled": ("cancel", "Booking cancelled", True),
    "rescheduled": ("change", "Booking moved", True),
    "reassigned": ("change", "Stylist changed", True),
    "paid": ("change", "Payment received", True),
}

SALON_ROLES = {Role.super_admin, Role.admin, Role.manager, Role.employee, Role.staff}


def _when(moment: datetime) -> str:
    local = moment.astimezone(KOLKATA)
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{local.day} {local.strftime('%b %Y')}, {hour}:{local.strftime('%M %p')}"


def _prefs(tenant: Tenant | None) -> dict:
    raw = tenant.notification_prefs if tenant is not None else None
    merged = {**DEFAULT_NOTIFICATION_PREFS, **(raw or {})}
    return {
        "newBookings": merged.get("newBookings", merged.get("new_bookings", True)),
        "cancellations": merged.get("cancellations", True),
    }


async def _people(db: AsyncSession, salon: Salon, customer: Customer, staff: User | None, previous_staff_id) -> list[User]:
    members = (
        await db.scalars(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(
                Membership.salon_id == salon.id,
                User.is_active.is_(True),
                User.password_hash.is_not(None),
                User.role.in_(SALON_ROLES),
            )
        )
    ).all()
    owners = (
        await db.scalars(
            select(User).where(
                User.tenant_id == salon.tenant_id,
                User.role == Role.master_admin,
                User.is_active.is_(True),
                User.password_hash.is_not(None),
            )
        )
    ).all()
    found = {person.id: person for person in (*members, *owners)}
    if staff is not None and staff.is_active and staff.password_hash:
        found[staff.id] = staff
    if previous_staff_id and previous_staff_id not in found:
        previous = await db.get(User, previous_staff_id)
        if previous is not None and previous.is_active and previous.password_hash:
            found[previous.id] = previous
    if customer.user_id and customer.user_id not in found:
        account = await db.get(User, customer.user_id)
        if account is not None and account.is_active and account.password_hash:
            found[account.id] = account
    return list(found.values())


def _customer_addresses(customer: Customer, people: list[User]) -> set[str]:
    addresses = set()
    if customer.email:
        addresses.add(customer.email.strip().lower())
    if customer.user_id:
        account = next((person for person in people if person.id == customer.user_id), None)
        if account and account.email:
            addresses.add(account.email.strip().lower())
    return {item for item in addresses if item}


async def publish(
    db: AsyncSession,
    *,
    salon: Salon,
    customer: Customer,
    staff: User | None,
    event: str,
    customer_text: str,
    team_text: str,
    customer_subject: str,
    team_subject: str,
    previous_staff_id=None,
) -> None:
    kind, title, send = EVENTS[event]
    people = await _people(db, salon, customer, staff, previous_staff_id)
    customer_ids = {customer.user_id} if customer.user_id else set()
    for person in people:
        text = customer_text if person.id in customer_ids else team_text
        db.add(Notice(user_id=person.id, salon_id=salon.id, kind=kind, title=title, body=text))

    if not send:
        return
    tenant = await db.get(Tenant, salon.tenant_id)
    prefs = _prefs(tenant)
    team_allowed = prefs["cancellations"] if event == "cancelled" else prefs["newBookings"]
    messages: list[tuple[str, str, str]] = []
    sent: set[str] = set()
    for address in _customer_addresses(customer, people):
        sent.add(address)
        messages.append((address, customer_subject, customer_text))
    if team_allowed:
        for person in people:
            if person.id in customer_ids or not person.email:
                continue
            address = person.email.strip().lower()
            if address in sent:
                continue
            sent.add(address)
            messages.append((address, team_subject, team_text))
    await _deliver(messages)


async def _deliver(messages: list[tuple[str, str, str]]) -> None:
    """Write the bell now. Live mail goes out after the status is saved, so Confirm does not sit and wait."""
    if not messages:
        return
    if get_settings().email_backend != "smtp":
        for address, subject, body in messages:
            await send_email(address, subject, body)
        return

    async def _run() -> None:
        for address, subject, body in messages:
            await send_email(address, subject, body)

    task = asyncio.create_task(_run())
    _mail_tasks.add(task)
    task.add_done_callback(_mail_tasks.discard)


async def announce_visit(
    db: AsyncSession,
    *,
    salon: Salon,
    customer: Customer,
    service: Service,
    staff: User | None,
    event: str,
    when: datetime,
    previous_staff_id=None,
) -> None:
    stylist = staff.full_name if staff else "Not assigned"
    slot = _when(when)
    detail = f"{service.name} at {salon.name}\n{slot} IST\nStylist: {stylist}"
    team = f"{customer.full_name}\n{detail}"
    kind, title, _send = EVENTS[event]
    subjects = {
        "booked": ("Your appointment is confirmed", f"New booking: {service.name} at {salon.name}"),
        "confirmed": ("Your appointment is confirmed", f"Booking confirmed: {service.name} at {salon.name}"),
        "cancelled": ("Your appointment was cancelled", f"Booking cancelled: {service.name} at {salon.name}"),
        "rescheduled": ("Your appointment was moved", f"Booking moved: {service.name} at {salon.name}"),
        "billed": ("Your visit is complete", f"Visit completed: {service.name} at {salon.name}"),
        "no_show": ("You were marked as a no-show", f"No-show: {service.name} at {salon.name}"),
        "reassigned": ("Your stylist was changed", f"Stylist changed: {service.name} at {salon.name}"),
    }
    customer_subject, team_subject = subjects.get(event, (title, f"{title}: {service.name} at {salon.name}"))
    customer_text = f"{customer_subject}.\n\n{detail}\n"
    team_text = f"{title}.\n\n{team}\n"
    if kind == "booking" and event == "booked":
        customer_text = f"Your appointment is confirmed.\n\n{detail}\n"
    await publish(
        db,
        salon=salon,
        customer=customer,
        staff=staff,
        event=event,
        customer_text=customer_text,
        team_text=team_text,
        customer_subject=customer_subject,
        team_subject=team_subject,
        previous_staff_id=previous_staff_id,
    )


async def announce_payment(db: AsyncSession, invoice, customer: Customer) -> None:
    salon = await db.get(Salon, invoice.salon_id)
    if salon is None or customer is None:
        return
    amount = f"₹{float(invoice.total):,.2f}"
    customer_text = f"Payment of {amount} was received at {salon.name}.\nBill {invoice.number}\n"
    team_text = f"Payment of {amount} from {customer.full_name} at {salon.name}.\nBill {invoice.number}\n"
    await publish(
        db,
        salon=salon,
        customer=customer,
        staff=None,
        event="paid",
        customer_text=customer_text,
        team_text=team_text,
        customer_subject=f"Payment received at {salon.name}",
        team_subject=f"Payment received: {invoice.number}",
    )


_STATUS_EVENT = {
    AppointmentStatus.booked: "booked",
    AppointmentStatus.confirmed: "confirmed",
    AppointmentStatus.checked_in: "checked_in",
    AppointmentStatus.in_service: "in_service",
    AppointmentStatus.completed: "billed",
    AppointmentStatus.billed: "billed",
    AppointmentStatus.no_show: "no_show",
    AppointmentStatus.cancelled: "cancelled",
}


async def catch_up(db: AsyncSession, customer: Customer) -> None:
    """Bell items for visits that were booked before this login was linked.

    The salon already got its email when the visit was saved. This only fills
    the customer's bell, and only when that bell is still empty.
    """
    if customer.user_id is None:
        return
    existing = await db.scalar(select(func.count()).select_from(Notice).where(Notice.user_id == customer.user_id))
    if existing:
        return
    staff = User
    rows = (
        await db.execute(
            select(Appointment, Service, Salon, staff)
            .join(Service, Service.id == Appointment.service_id)
            .join(Salon, Salon.id == Appointment.salon_id)
            .outerjoin(staff, staff.id == Appointment.staff_user_id)
            .where(Appointment.customer_id == customer.id)
            .order_by(Appointment.starts_at)
        )
    ).all()
    for appt, service, salon, stylist in rows:
        event = _STATUS_EVENT.get(appt.status)
        if event is None:
            continue
        kind, title, _send = EVENTS[event]
        slot = _when(appt.starts_at)
        who = stylist.full_name if stylist is not None else "Not assigned"
        detail = f"{service.name} at {salon.name}\n{slot} IST\nStylist: {who}"
        subjects = {
            "booked": "Your appointment is confirmed",
            "confirmed": "Your appointment is confirmed",
            "cancelled": "Your appointment was cancelled",
            "billed": "Your visit is complete",
            "no_show": "You were marked as a no-show",
        }
        subject = subjects.get(event, title)
        text = f"Your appointment is confirmed.\n\n{detail}\n" if event == "booked" else f"{subject}.\n\n{detail}\n"
        db.add(Notice(user_id=customer.user_id, salon_id=salon.id, kind=kind, title=title, body=text))


def visit_event(previous_status: str, previous_start: datetime, previous_staff, appt) -> str | None:
    """The one change worth announcing after an appointment update."""
    status = appt.status.value
    if previous_status != status:
        if status in {"completed", "billed"}:
            return "billed"
        return status
    if previous_start != appt.starts_at:
        return "rescheduled"
    if previous_staff != appt.staff_user_id:
        return "reassigned"
    return None
