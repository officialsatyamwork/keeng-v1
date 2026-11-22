"""Paid and unpaid invoice totals. Managers never call these."""

import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, Invoice, InvoiceLine, InvoiceStatus, Shift, StaffLeave, StaffProfile

KOLKATA = ZoneInfo("Asia/Kolkata")


def _money(value) -> float:
    return round(float(value or 0), 2)


async def revenue_by_salon(db: AsyncSession, salon_ids: list[uuid.UUID]) -> dict[uuid.UUID, float]:
    if not salon_ids:
        return {}
    rows = await db.execute(
        select(Invoice.salon_id, func.coalesce(func.sum(Invoice.total), 0))
        .where(Invoice.salon_id.in_(salon_ids), Invoice.status == InvoiceStatus.paid)
        .group_by(Invoice.salon_id)
    )
    return {sid: _money(total) for sid, total in rows.all()}


async def appointments_by_salon(db: AsyncSession, salon_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not salon_ids:
        return {}
    rows = await db.execute(
        select(Appointment.salon_id, func.count())
        .where(Appointment.salon_id.in_(salon_ids))
        .group_by(Appointment.salon_id)
    )
    return {sid: n for sid, n in rows.all()}


async def paid_total(db: AsyncSession, salon_ids: list[uuid.UUID]) -> float:
    if not salon_ids:
        return 0
    total = await db.scalar(
        select(func.coalesce(func.sum(Invoice.total), 0)).where(
            Invoice.salon_id.in_(salon_ids), Invoice.status == InvoiceStatus.paid
        )
    )
    return _money(total)


async def unpaid_total(db: AsyncSession, salon_ids: list[uuid.UUID]) -> float:
    if not salon_ids:
        return 0
    total = await db.scalar(
        select(func.coalesce(func.sum(Invoice.total), 0)).where(
            Invoice.salon_id.in_(salon_ids), Invoice.status == InvoiceStatus.unpaid
        )
    )
    return _money(total)


async def revenue_by_day(db: AsyncSession, salon_ids: list[uuid.UUID], days: int = 7) -> list[dict]:
    today = datetime.now(KOLKATA).date()
    labels = []
    buckets: dict[str, float] = {}
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        label = day.strftime("%a") if days <= 7 else f"{day.day} {day.strftime('%b')}"
        labels.append((day.isoformat(), label))
        buckets[day.isoformat()] = 0
    if salon_ids:
        start = datetime.combine(today - timedelta(days=days - 1), time.min, tzinfo=KOLKATA)
        rows = await db.execute(
            select(Invoice.paid_at, Invoice.total).where(
                Invoice.salon_id.in_(salon_ids),
                Invoice.status == InvoiceStatus.paid,
                Invoice.paid_at >= start,
            )
        )
        for paid_at, total in rows.all():
            key = paid_at.astimezone(KOLKATA).date().isoformat()
            if key in buckets:
                buckets[key] = round(buckets[key] + float(total), 2)
    return [{"day": label, "revenue": buckets[key]} for key, label in labels]


def _share(user_id: uuid.UUID, line_staff: uuid.UUID | None, splits) -> float:
    """1 when the line belongs to this person. A split list divides that line."""
    if splits:
        for item in splits:
            sid = item.get("staffUserId") or item.get("staff_user_id")
            if sid and str(sid) == str(user_id):
                return float(item.get("percent") or 0) / 100
        return 0
    return 1.0 if line_staff == user_id else 0


async def staff_earnings(
    db: AsyncSession, user_id: uuid.UUID, salon_ids: list[uuid.UUID], start: datetime, end: datetime
) -> tuple[float, float, float]:
    """Service pay, product pay, and their sum from paid bills in the window.

    A service line counts only when it names this person (or a split includes them).
    GST is not part of the base. Unpaid bills are left out. The plan on the staff
    profile chooses a flat percent, a slab, or a fixed rupee amount per service.
    """
    if not salon_ids:
        return 0, 0, 0
    profile = await db.scalar(select(StaffProfile).where(StaffProfile.user_id == user_id))
    kind_plan = profile.commission_kind if profile else "percent"
    service_percent = float(profile.commission_percent) if profile else 10.0
    product_percent = float(profile.product_commission_percent) if profile else 0.0
    slab_upto = float(profile.slab_upto) if profile else 50000.0
    slab_percent = float(profile.slab_percent) if profile else 10.0
    slab_after = float(profile.slab_after_percent) if profile else 15.0
    fixed_amount = float(profile.fixed_amount) if profile else 0.0
    rows = (
        await db.execute(
            select(
                InvoiceLine.kind,
                InvoiceLine.unit_price,
                InvoiceLine.qty,
                InvoiceLine.staff_user_id,
                InvoiceLine.splits,
            )
            .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
            .where(
                Invoice.salon_id.in_(salon_ids),
                Invoice.status == InvoiceStatus.paid,
                Invoice.paid_at >= start,
                Invoice.paid_at < end,
            )
        )
    ).all()
    service_base = 0.0
    service_qty = 0.0
    product_base = 0.0
    for kind, price, qty, line_staff, splits in rows:
        share = _share(user_id, line_staff, splits)
        if share <= 0:
            continue
        amount = float(price) * qty * share
        if kind == "service":
            service_base += amount
            service_qty += qty * share
        elif kind == "product":
            product_base += amount
    if kind_plan == "fixed":
        service_pay = round(service_qty * fixed_amount, 2)
    elif kind_plan == "slab":
        lower = min(service_base, slab_upto)
        higher = max(0.0, service_base - slab_upto)
        service_pay = round(lower * slab_percent / 100 + higher * slab_after / 100, 2)
    else:
        service_pay = round(service_base * service_percent / 100, 2)
    product_pay = round(product_base * product_percent / 100, 2)
    return service_pay, product_pay, round(service_pay + product_pay, 2)


async def month_payroll(db: AsyncSession, user_id: uuid.UUID, salon_id: uuid.UUID, start: datetime, end: datetime) -> dict:
    """Base salary for days worked, plus commission and incentive, minus advances."""
    service_pay, product_pay, commission = await staff_earnings(db, user_id, [salon_id], start, end)
    profile = await db.scalar(select(StaffProfile).where(StaffProfile.user_id == user_id))
    shifts = (
        await db.scalars(select(Shift).where(Shift.user_id == user_id, Shift.salon_id == salon_id))
    ).all()
    leaves = (
        await db.scalars(
            select(StaffLeave).where(
                StaffLeave.user_id == user_id,
                StaffLeave.salon_id == salon_id,
                StaffLeave.day >= start.date(),
                StaffLeave.day < end.date(),
            )
        )
    ).all()
    weekdays = {row.weekday for row in shifts}
    off = {row.day for row in leaves}
    scheduled = attended = 0
    if weekdays:
        day = start.date()
        last = end.date() - timedelta(days=1)
        while day <= last:
            if day.weekday() in weekdays:
                scheduled += 1
                if day not in off:
                    attended += 1
            day += timedelta(days=1)
        ratio = attended / scheduled if scheduled else 1
    else:
        ratio = 1
    salary = round(float(profile.base_salary if profile else 0) * ratio, 2)
    incentive = round(float(profile.incentive if profile else 0), 2)
    advance = round(float(profile.advance if profile else 0), 2)
    total = round(salary + commission + incentive - advance, 2)
    return {
        "service_pay": service_pay,
        "product_pay": product_pay,
        "commission": commission,
        "salary": salary,
        "incentive": incentive,
        "advance": advance,
        "attended": attended,
        "scheduled": scheduled,
        "total": total,
    }


def payslip_pdf(lines: list[str]) -> bytes:
    """A one-page payslip. Helvetica only, so no extra library is required."""
    commands = ["BT", "/F1 11 Tf"]
    y = 780
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"1 0 0 1 48 {y} Tm ({safe}) Tj")
        y -= 16
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    parts = [b"%PDF-1.4\n"]
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(sum(len(part) for part in parts))
        parts.append(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref_at = sum(len(part) for part in parts)
    xref = [f"xref\n0 {len(objects) + 1}\n".encode(), b"0000000000 65535 f \n"]
    for offset in offsets[1:]:
        xref.append(f"{offset:010d} 00000 n \n".encode())
    trailer = (
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    )
    return b"".join(parts + xref + [trailer])


async def top_services(db: AsyncSession, salon_ids: list[uuid.UUID], limit: int = 6) -> list[dict]:
    if not salon_ids:
        return []
    rows = await db.execute(
        select(InvoiceLine.name, func.coalesce(func.sum(InvoiceLine.line_total), 0))
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .where(
            Invoice.salon_id.in_(salon_ids),
            Invoice.status == InvoiceStatus.paid,
            InvoiceLine.kind == "service",
        )
        .group_by(InvoiceLine.name)
        .order_by(func.sum(InvoiceLine.line_total).desc())
        .limit(limit)
    )
    return [{"name": name, "revenue": _money(total)} for name, total in rows.all()]
