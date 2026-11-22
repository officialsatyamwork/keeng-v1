"""One customer profile for the whole platform.

A phone, an email, or the same name is the same person. Booking and billing
reuse that profile instead of saving the details again.
"""

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound
from app.models import Appointment, Customer, Invoice, Role, Salon, User


async def find_customer(
    db: AsyncSession,
    *,
    name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    except_id: uuid.UUID | None = None,
) -> Customer | None:
    """The existing profile for this phone, email, or name. None when the person is new."""
    phone = phone or None
    email = email.strip().lower() if email else None
    name = name.strip() if name else None

    def skip(stmt):
        if except_id is None:
            return stmt
        return stmt.where(Customer.id != except_id)

    if phone:
        row = await db.scalar(skip(select(Customer).where(Customer.phone == phone)))
        if row:
            return row
    if email:
        row = await db.scalar(skip(select(Customer).where(func.lower(Customer.email) == email)))
        if row:
            return row
    if not name:
        return None
    rows = list(
        (
            await db.scalars(
                skip(select(Customer).where(func.lower(Customer.full_name) == name.lower()).order_by(Customer.created_at))
            )
        ).all()
    )
    for row in rows:
        phone_ok = not phone or not row.phone or row.phone == phone
        email_ok = not email or not row.email or row.email.lower() == email
        if phone_ok and email_ok:
            return row
    return None


async def reuse_or_create(
    db: AsyncSession,
    salon: Salon,
    *,
    name: str,
    phone: str | None = None,
    email: str | None = None,
    notes: str | None = None,
    date_of_birth=None,
    allergies: str | None = None,
    preferences: str | None = None,
    user_id: uuid.UUID | None = None,
) -> Customer:
    """Return the platform profile for this person, creating it only when none exists."""
    found = await find_customer(db, name=name, phone=phone, email=email)
    if found:
        if phone and not found.phone:
            found.phone = phone
        if email and not found.email:
            found.email = email.strip().lower()
        if user_id and found.user_id is None:
            found.user_id = user_id
        await claim_account(db, found)
        return found
    row = Customer(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        user_id=user_id,
        full_name=name.strip(),
        phone=phone,
        email=email.strip().lower() if email else None,
        notes=notes,
        date_of_birth=date_of_birth,
        allergies=allergies,
        preferences=preferences,
    )
    db.add(row)
    await db.flush()
    await claim_account(db, row)
    return row


async def _customer_account(db: AsyncSession, *, phone: str | None, email: str | None) -> User | None:
    """The customer login for this phone or email. Salon staff are left alone."""
    if phone:
        account = await db.scalar(select(User).where(User.phone == phone, User.role == Role.customer, User.is_active.is_(True)))
        if account is not None:
            return account
    if email:
        account = await db.scalar(
            select(User).where(
                func.lower(User.email) == email.strip().lower(),
                User.role == Role.customer,
                User.is_active.is_(True),
            )
        )
        if account is not None:
            return account
    return None


async def claim_account(db: AsyncSession, row: Customer) -> None:
    """Attach the customer login when the salon already saved this phone or email."""
    if row.user_id is not None:
        return
    account = await _customer_account(db, phone=row.phone, email=row.email)
    if account is None:
        return
    taken = await db.scalar(
        select(Customer.id).where(
            Customer.user_id == account.id,
            Customer.tenant_id == row.tenant_id,
            Customer.id != row.id,
        )
    )
    if taken is not None:
        return
    row.user_id = account.id


async def attach_login(db: AsyncSession, user: User) -> Customer | None:
    """Connect this customer login to the salon profile that already has their phone or email.

    A desk booking made before the person registered is the usual case. Linking
    it here is what makes that visit show up on the customer's own pages.
    """
    if user.role != Role.customer:
        return None
    linked = await db.scalar(select(Customer).where(Customer.user_id == user.id).order_by(Customer.created_at))
    if linked is not None:
        from app.services.notices import catch_up

        await catch_up(db, linked)
        return linked
    row = None
    if user.phone:
        row = await db.scalar(select(Customer).where(Customer.phone == user.phone, Customer.user_id.is_(None)))
    if row is None and user.email:
        row = await db.scalar(
            select(Customer).where(func.lower(Customer.email) == user.email.strip().lower(), Customer.user_id.is_(None))
        )
    if row is None:
        return None
    row.user_id = user.id
    await db.flush()
    from app.services.notices import catch_up

    await catch_up(db, row)
    return row


def duplicate_message(found: Customer, *, phone: str | None, email: str | None) -> str:
    if phone and found.phone == phone:
        return f"{found.full_name} is already a customer with this phone. A second profile was not created."
    if email and found.email and found.email.lower() == email.strip().lower():
        return f"{found.full_name} is already a customer with this email. A second profile was not created."
    return f"{found.full_name} is already a customer. A second profile was not created."


def visible_to_salon(salon: Salon):
    """Customers of this business, plus anyone already served here."""
    return or_(
        (Customer.tenant_id == salon.tenant_id) & ((Customer.salon_id == salon.id) | (Customer.share_across_branches.is_(True))),
        Customer.id.in_(select(Appointment.customer_id).where(Appointment.salon_id == salon.id)),
        Customer.id.in_(select(Invoice.customer_id).where(Invoice.salon_id == salon.id)),
    )


async def ensure_customer_access(db: AsyncSession, user, row: Customer) -> None:
    """The home salon can open the profile. A salon that has already served them can too."""
    from app.services.access import accessible_salon_ids, ensure_salon_access

    try:
        await ensure_salon_access(db, user, row.salon_id)
        return
    except NotFound:
        pass
    salon_ids = await accessible_salon_ids(db, user)
    if not salon_ids:
        raise NotFound("Customer not found")
    served = await db.scalar(
        select(Appointment.id).where(Appointment.customer_id == row.id, Appointment.salon_id.in_(salon_ids)).limit(1)
    )
    if served is None:
        served = await db.scalar(
            select(Invoice.id).where(Invoice.customer_id == row.id, Invoice.salon_id.in_(salon_ids)).limit(1)
        )
    if served is None:
        raise NotFound("Customer not found")
