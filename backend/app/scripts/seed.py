"""Create a demo business with one user per role.

    python -m app.scripts.seed            # uses SEED_PASSWORD or the default below

Safe to run more than once: if the demo owner already exists, it only adds the employee account when that account is missing.
Do not run this against a production database.
"""

import asyncio
import os
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import dispose_engine, get_sessionmaker
from app.models import (
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    Customer,
    CustomerPackage,
    Membership,
    Package,
    PackageStatus,
    Role,
    Salon,
    Product,
    Service,
    Shift,
    StaffProfile,
    Tenant,
    User,
)

KOLKATA = ZoneInfo("Asia/Kolkata")

DEMO_PASSWORD = os.environ.get("SEED_PASSWORD", "Keeng@123")


async def _ensure_demo_user(db, owner: User, *, email: str, name: str, role: Role, phone: str, title: str) -> None:
    """Add one demo account when an older seed ran before that role existed."""
    if await db.scalar(select(func.count()).select_from(User).where(User.email == email)):
        return
    salon = await db.scalar(
        select(Salon).where(Salon.tenant_id == owner.tenant_id, Salon.name == "Glow Salon - Andheri")
    )
    if salon is None or owner.tenant_id is None:
        return
    user = User(
        tenant_id=owner.tenant_id,
        email=email,
        full_name=name,
        role=role,
        job_title=title,
        password_hash=owner.password_hash,
        phone=phone,
    )
    db.add(user)
    await db.flush()
    db.add(Membership(user_id=user.id, salon_id=salon.id, granted_by_id=owner.id))
    print(f"Added {email} (same password as the other demo users)")


async def _ensure_employee(db, owner: User) -> None:
    """Add the receptionist if an older seed ran before the employee role existed."""
    await _ensure_demo_user(
        db, owner, email="employee@glowsalon.com", name="Neha Desai", role=Role.employee, phone="9876500013", title="Receptionist"
    )


async def _ensure_v2(db, owner: User) -> None:
    """Sample services, one customer, and two bookings so the V2 desks are not empty."""
    salon = await db.scalar(select(Salon).where(Salon.tenant_id == owner.tenant_id, Salon.name == "Glow Salon - Andheri"))
    if salon is None:
        return
    if await db.scalar(select(func.count()).select_from(Service).where(Service.salon_id == salon.id)):
        return
    haircut = Service(tenant_id=salon.tenant_id, salon_id=salon.id, name="Haircut", category="Hair", duration_minutes=45, price=700)
    color = Service(tenant_id=salon.tenant_id, salon_id=salon.id, name="Hair Color", category="Hair", duration_minutes=90, price=2500)
    facial = Service(tenant_id=salon.tenant_id, salon_id=salon.id, name="Facial", category="Skin", duration_minutes=60, price=1800)
    nails = Service(tenant_id=salon.tenant_id, salon_id=salon.id, name="Manicure", category="Nails", duration_minutes=45, price=800)
    db.add_all([haircut, color, facial, nails])
    await db.flush()

    riya = await db.scalar(select(User).where(User.email == "riya@glowsalon.com"))
    priya_login = await db.scalar(select(User).where(User.email == "customer@example.com"))
    if riya and not await db.scalar(select(StaffProfile).where(StaffProfile.user_id == riya.id)):
        db.add(StaffProfile(user_id=riya.id, commission_percent=15))
        db.add_all(
            [
                Shift(user_id=riya.id, salon_id=salon.id, weekday=day, start_time=time(10, 0), end_time=time(19, 0))
                for day in range(6)
            ]
        )
    priya = Customer(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        user_id=priya_login.id if priya_login else None,
        full_name="Priya Sharma",
        phone="9876500016",
        email="customer@example.com",
        notes="Prefers a quiet chair.",
        date_of_birth=date(1992, 11, 20),
        allergies="Sensitive to ammonia hair colour. Do a patch test before colour.",
        preferences="Quiet chair. Shoulder-length layers. Usually books Riya.",
    )
    db.add(priya)
    await db.flush()
    today = datetime.now(KOLKATA).date()
    start = datetime.combine(today, time(11, 0), tzinfo=KOLKATA)
    yesterday = datetime.combine(today - timedelta(days=1), time(16, 0), tzinfo=KOLKATA)
    db.add_all(
        [
            Appointment(
                tenant_id=salon.tenant_id,
                salon_id=salon.id,
                customer_id=priya.id,
                service_id=color.id,
                staff_user_id=riya.id if riya else None,
                starts_at=start,
                ends_at=start + timedelta(minutes=90),
                status=AppointmentStatus.confirmed,
                source=AppointmentSource.desk,
            ),
            Appointment(
                tenant_id=salon.tenant_id,
                salon_id=salon.id,
                customer_id=priya.id,
                service_id=haircut.id,
                staff_user_id=riya.id if riya else None,
                starts_at=yesterday,
                ends_at=yesterday + timedelta(minutes=45),
                status=AppointmentStatus.completed,
                source=AppointmentSource.desk,
            ),
        ]
    )
    bundle = Package(
        tenant_id=salon.tenant_id, salon_id=salon.id, name="Glow 6", sessions=6, price=4500, validity_days=180
    )
    db.add(bundle)
    await db.flush()
    db.add(
        CustomerPackage(
            customer_id=priya.id,
            package_id=bundle.id,
            sessions_total=6,
            sessions_used=1,
            expires_at=datetime.now(UTC) + timedelta(days=180),
            status=PackageStatus.active,
        )
    )
    priya.loyalty_points = 1
    if priya_login:
        priya_login.date_of_birth = date(1992, 11, 20)
        priya_login.allergies = priya.allergies
        priya_login.preferences = priya.preferences
    print("Added Glow Salon services, Priya Sharma, and two sample bookings")


async def _fill_priya_profile(db) -> None:
    """Give the demo customer a birthday, allergies, and preferences on an existing database."""
    account = await db.scalar(select(User).where(User.email == "customer@example.com"))
    row = await db.scalar(select(Customer).where(Customer.email == "customer@example.com"))
    if account is None and row is None:
        return
    if (account and account.date_of_birth) or (row and row.date_of_birth):
        return
    dob = date(1992, 11, 20)
    allergies = "Sensitive to ammonia hair colour. Do a patch test before colour."
    preferences = "Quiet chair. Shoulder-length layers. Usually books Riya."
    if account:
        account.date_of_birth = dob
        account.allergies = allergies
        account.preferences = preferences
    if row:
        row.date_of_birth = dob
        row.allergies = allergies
        row.preferences = preferences
    print("Added Priya Sharma's birthday, allergies, and preferences")


async def _ensure_v3(db, owner: User) -> None:
    """Retail stock for the demo salon. Bills stay empty until the desk creates one."""
    salon = await db.scalar(select(Salon).where(Salon.tenant_id == owner.tenant_id, Salon.name.contains("Andheri")))
    if salon is None:
        return
    existing = await db.scalar(select(func.count()).select_from(Product).where(Product.salon_id == salon.id))
    if existing:
        return
    db.add_all(
        [
            Product(tenant_id=salon.tenant_id, salon_id=salon.id, name="Wella Shampoo 500ml", category="Hair", stock=8, min_stock=10, price=650, supplier="Wella"),
            Product(tenant_id=salon.tenant_id, salon_id=salon.id, name="Waxing Strips", category="Body", stock=3, min_stock=10, price=200, supplier="Rica"),
            Product(tenant_id=salon.tenant_id, salon_id=salon.id, name="Facial Cleanser", category="Skin", stock=20, min_stock=8, price=450, supplier="Lotus"),
        ]
    )
    print("Added Andheri retail stock")


async def main() -> None:
    if get_settings().is_production:
        raise SystemExit("Refusing to seed demo data in production")
    async with get_sessionmaker()() as db:
        owner_row = await db.scalar(select(User).where(User.email == "owner@glowsalon.com"))
        if owner_row:
            await _ensure_employee(db, owner_row)
            await _ensure_demo_user(
                db,
                owner_row,
                email="salonadmin@glowsalon.com",
                name="Meera Joshi",
                role=Role.admin,
                phone="9876500017",
                title="Salon Admin",
            )
            await _ensure_v2(db, owner_row)
            await _fill_priya_profile(db)
            await _ensure_v3(db, owner_row)
            await db.commit()
            print("Demo data already present")
            return
        pw = hash_password(DEMO_PASSWORD)
        tenant = Tenant(
            name="Glow Salon",
            business_type="Salon",
            email="owner@glowsalon.com",
            phone="9876500000",
            address="12, Link Road, Andheri West, Mumbai",
            gst_number="27AABCU9603R1ZX",
            trial_ends_at=datetime.now(UTC) + timedelta(days=14),
        )
        db.add(tenant)
        await db.flush()
        andheri = Salon(
            tenant_id=tenant.id,
            name="Glow Salon - Andheri",
            city="Mumbai",
            address="12, Link Road, Andheri West",
            phone="9876500001",
        )
        bandra = Salon(
            tenant_id=tenant.id,
            name="Glow Salon - Bandra",
            city="Mumbai",
            address="45, Hill Road, Bandra West",
            phone="9876500002",
        )
        powai = Salon(
            tenant_id=tenant.id,
            name="Glow Salon - Powai",
            city="Mumbai",
            address="8, Hiranandani Gardens, Powai",
            phone="9876500003",
        )
        db.add_all([andheri, bandra, powai])
        await db.flush()

        def u(email, name, role, phone, title=None, tid=tenant.id):
            return User(
                tenant_id=tid, email=email, full_name=name, role=role, job_title=title, password_hash=pw, phone=phone
            )

        owner = u("owner@glowsalon.com", "Geeta Anand", Role.master_admin, "9876500010", "Owner")
        admin = u("admin@glowsalon.com", "Rahul Verma", Role.super_admin, "9876500011", "Area Admin")
        salon_admin = u("salonadmin@glowsalon.com", "Meera Joshi", Role.admin, "9876500017", "Salon Admin")
        manager = u("manager@glowsalon.com", "Sunita Iyer", Role.manager, "9876500012", "Branch Manager")
        employee = u("employee@glowsalon.com", "Neha Desai", Role.employee, "9876500013", "Receptionist")
        stylist = u("riya@glowsalon.com", "Riya Kapoor", Role.staff, "9876500014", "Senior Stylist")
        stylist2 = u("pooja@glowsalon.com", "Pooja Shah", Role.staff, "9876500015", "Nail Technician")
        customer = u("customer@example.com", "Priya Sharma", Role.customer, "9876500016", tid=None)
        db.add_all([owner, admin, salon_admin, manager, employee, stylist, stylist2, customer])
        await db.flush()
        db.add_all(
            [
                Membership(user_id=admin.id, salon_id=andheri.id, granted_by_id=owner.id),
                Membership(user_id=admin.id, salon_id=bandra.id, granted_by_id=owner.id),
                Membership(user_id=salon_admin.id, salon_id=andheri.id, granted_by_id=owner.id),
                Membership(user_id=manager.id, salon_id=andheri.id, granted_by_id=owner.id),
                Membership(user_id=employee.id, salon_id=andheri.id, granted_by_id=owner.id),
                Membership(user_id=stylist.id, salon_id=andheri.id, granted_by_id=owner.id),
                Membership(user_id=stylist2.id, salon_id=bandra.id, granted_by_id=owner.id),
            ]
        )
        await db.flush()
        await _ensure_v2(db, owner)
        await _fill_priya_profile(db)
        await _ensure_v3(db, owner)
        await db.commit()
    await dispose_engine()
    print(f"Seeded demo business. Password for every demo user: {DEMO_PASSWORD}")
    for email, role in [
        ("owner@glowsalon.com", "master_admin"),
        ("admin@glowsalon.com", "super_admin (Andheri + Bandra)"),
        ("salonadmin@glowsalon.com", "admin (Andheri)"),
        ("manager@glowsalon.com", "manager (Andheri)"),
        ("employee@glowsalon.com", "employee (Andheri)"),
        ("riya@glowsalon.com", "staff (Andheri)"),
        ("customer@example.com", "customer"),
    ]:
        print(f"  {email:28} {role}")


if __name__ == "__main__":
    asyncio.run(main())
