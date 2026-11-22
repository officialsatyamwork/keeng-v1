"""Wipe all app data and create the master admin from .env.

    python -m app.scripts.bootstrap_master

Requires MASTER_ADMIN_EMAIL and MASTER_ADMIN_PASSWORD in backend/.env.
Refuses to run when ENVIRONMENT=production.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import dispose_engine, get_engine, get_sessionmaker
from app.models import Base, Role, Salon, Tenant, User


async def _clear_database() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
        if tables:
            await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


async def _create_master_admin() -> User:
    settings = get_settings()
    email = (settings.master_admin_email or "").strip().lower()
    password = settings.master_admin_password or ""
    if not email or not password:
        raise SystemExit(
            "Set MASTER_ADMIN_EMAIL and MASTER_ADMIN_PASSWORD in backend/.env before bootstrapping"
        )
    if len(password) < 8:
        raise SystemExit("MASTER_ADMIN_PASSWORD must be at least 8 characters")

    async with get_sessionmaker()() as db:
        existing = await db.scalar(select(User).where(User.email == email))
        if existing is not None:
            raise SystemExit(f"User already exists for {email}; clear the database first")

        tenant = Tenant(
            name=settings.master_admin_business_name,
            business_type="Salon",
            email=email,
            phone=settings.master_admin_phone,
            trial_ends_at=datetime.now(UTC) + timedelta(days=settings.trial_days),
        )
        db.add(tenant)
        await db.flush()

        salon = Salon(
            tenant_id=tenant.id,
            name=settings.master_admin_business_name,
            phone=settings.master_admin_phone,
        )
        owner = User(
            tenant_id=tenant.id,
            email=email,
            phone=settings.master_admin_phone,
            full_name=settings.master_admin_name,
            password_hash=hash_password(password),
            role=Role.master_admin,
            job_title="Owner",
        )
        db.add_all([salon, owner])
        await db.commit()
        await db.refresh(owner)
        return owner


async def main() -> None:
    settings = get_settings()
    if settings.is_production:
        raise SystemExit("Refusing to wipe/bootstrap in production")

    print("Clearing all application tables…")
    await _clear_database()
    owner = await _create_master_admin()
    await dispose_engine()
    print(f"Master admin ready: {owner.email} ({owner.full_name})")
    print(f"Business: {settings.master_admin_business_name}")


if __name__ == "__main__":
    asyncio.run(main())
