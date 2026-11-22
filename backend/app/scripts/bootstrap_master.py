"""Wipe all app data and create the master admin in the database.

    python -m app.scripts.bootstrap_master \\
        --email you@example.com --password 'your-password'

Optional: --name, --phone, --business-name.
Refuses to run when ENVIRONMENT=production.
Credentials are stored only as a hashed user row — not in .env.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import dispose_engine, get_engine, get_sessionmaker
from app.models import Base, Role, Salon, Tenant, User


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Wipe the DB and create the master admin user")
    p.add_argument("--email", required=True, help="Master admin email (login identity)")
    p.add_argument("--password", required=True, help="Master admin password (stored hashed)")
    p.add_argument("--name", default="Master Admin", help="Full name")
    p.add_argument("--phone", default="9876500000", help="Phone number")
    p.add_argument("--business-name", default="Keeng Salon", help="Tenant / salon name")
    return p.parse_args()


async def _clear_database() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
        if tables:
            await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


async def _create_master_admin(
    *,
    email: str,
    password: str,
    name: str,
    phone: str,
    business_name: str,
) -> User:
    email = email.strip().lower()
    if not email or not password:
        raise SystemExit("--email and --password are required")
    if len(password) < 8:
        raise SystemExit("--password must be at least 8 characters")

    settings = get_settings()
    async with get_sessionmaker()() as db:
        existing = await db.scalar(select(User).where(User.email == email))
        if existing is not None:
            raise SystemExit(f"User already exists for {email}; clear the database first")

        tenant = Tenant(
            name=business_name,
            business_type="Salon",
            email=email,
            phone=phone,
            trial_ends_at=datetime.now(UTC) + timedelta(days=settings.trial_days),
        )
        db.add(tenant)
        await db.flush()

        salon = Salon(
            tenant_id=tenant.id,
            name=business_name,
            phone=phone,
        )
        owner = User(
            tenant_id=tenant.id,
            email=email,
            phone=phone,
            full_name=name,
            password_hash=hash_password(password),
            role=Role.master_admin,
            job_title="Owner",
        )
        db.add_all([salon, owner])
        await db.commit()
        await db.refresh(owner)
        return owner


async def main() -> None:
    args = _parse_args()
    settings = get_settings()
    if settings.is_production:
        raise SystemExit("Refusing to wipe/bootstrap in production")

    print("Clearing all application tables…")
    await _clear_database()
    owner = await _create_master_admin(
        email=args.email,
        password=args.password,
        name=args.name,
        phone=args.phone,
        business_name=args.business_name,
    )
    await dispose_engine()
    print(f"Master admin ready in DB: {owner.email} ({owner.full_name})")
    print(f"Business: {args.business_name}")


if __name__ == "__main__":
    asyncio.run(main())
