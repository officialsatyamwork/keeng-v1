"""GST bills, stock, campaigns, and sales reports.

Revenue is the sum of paid invoices. Managers, front desk, and staff never
receive these totals. A campaign records the message and who it is for. It
does not send WhatsApp, SMS, or email.
"""

import uuid
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.api.deps import DB, CurrentUser
from app.core.errors import Conflict, NotFound
from app.models import (
    REVENUE_ROLES,
    Appointment,
    AppointmentStatus,
    Campaign,
    Customer,
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    Product,
    Role,
    Service,
    User,
)
from app.schemas import (
    CampaignIn,
    CampaignOut,
    InvoiceIn,
    InvoiceLineOut,
    InvoiceLinesIn,
    InvoiceOut,
    PayInvoiceIn,
    ProductIn,
    ProductOut,
    ProductPatch,
    ReportPay,
    ReportPoint,
    ReportStaff,
    ReportsOut,
)
from app.services.access import ensure_salon_access, require_role
from app.services.customers import attach_login, claim_account, reuse_or_create
from app.services.money import revenue_by_day

router = APIRouter(tags=["commerce"])

KOLKATA = ZoneInfo("Asia/Kolkata")
# The salon desk raises bills and keeps stock. The website owner does not.
BILLING = {Role.admin, Role.manager, Role.employee}
STOCK = {Role.admin, Role.manager, Role.employee}
OFFICE = REVENUE_ROLES
AUDIENCES = {"all", "birthday", "due", "recent"}


def _money(value) -> float:
    return round(float(value or 0), 2)


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


def _product_out(row: Product) -> ProductOut:
    return ProductOut(
        id=row.id,
        salon_id=row.salon_id,
        name=row.name,
        category=row.category,
        stock=row.stock,
        min_stock=row.min_stock,
        price=_money(row.price),
        gst_rate=_money(row.gst_rate),
        supplier=row.supplier,
        is_active=row.is_active,
        low_stock=row.stock <= row.min_stock,
    )


async def _invoice_out(db: DB, invoice: Invoice) -> InvoiceOut:
    customer = await db.get(Customer, invoice.customer_id)
    staff = aliased(User)
    rows = (
        await db.execute(
            select(InvoiceLine, staff.full_name)
            .outerjoin(staff, staff.id == InvoiceLine.staff_user_id)
            .where(InvoiceLine.invoice_id == invoice.id)
            .order_by(InvoiceLine.name)
        )
    ).all()
    return InvoiceOut(
        id=invoice.id,
        salon_id=invoice.salon_id,
        number=invoice.number,
        customer_id=invoice.customer_id,
        customer_name=customer.full_name if customer else "Customer",
        appointment_id=invoice.appointment_id,
        status=invoice.status.value,
        pay_method=invoice.pay_method,
        subtotal=_money(invoice.subtotal),
        discount=_money(invoice.discount),
        gst=_money(invoice.gst),
        total=_money(invoice.total),
        paid_at=invoice.paid_at,
        lines=[
            InvoiceLineOut(
                kind=line.kind,
                name=line.name,
                qty=line.qty,
                unit_price=_money(line.unit_price),
                gst_rate=_money(line.gst_rate),
                line_total=_money(line.line_total),
                staff_name=staff_name,
            )
            for line, staff_name in rows
        ],
    )


async def _next_number(db: DB, salon_id: uuid.UUID) -> str:
    count = await db.scalar(select(func.count()).select_from(Invoice).where(Invoice.salon_id == salon_id)) or 0
    return f"INV-{count + 1:04d}"


def _price_lines(raw: list[tuple[float, float, float]], discount_percent: float) -> tuple[float, float, float, list[float]]:
    """Return subtotal, discount, gst, and each line total including its GST."""
    subtotal = round(sum(price * qty for price, qty, _rate in raw), 2)
    discount = round(subtotal * discount_percent / 100, 2)
    taxable_base = subtotal - discount
    totals = []
    gst = 0.0
    for price, qty, rate in raw:
        base = round(price * qty, 2)
        share = 0 if subtotal == 0 else round(base / subtotal * taxable_base, 2)
        tax = round(share * rate / 100, 2)
        gst += tax
        totals.append(round(share + tax, 2))
    return subtotal, discount, round(gst, 2), totals


async def raise_visit_bill(db: DB, appt: Appointment) -> Invoice | None:
    """Create the unpaid service bill for a finished visit. A second call returns the existing bill."""
    existing = await db.scalar(select(Invoice).where(Invoice.appointment_id == appt.id))
    if existing is not None:
        return existing
    service = await db.get(Service, appt.service_id)
    if service is None:
        return None
    subtotal, discount, gst, totals = _price_lines([(float(service.price), 1, float(service.gst_rate))], 0)
    invoice = Invoice(
        tenant_id=appt.tenant_id,
        salon_id=appt.salon_id,
        customer_id=appt.customer_id,
        appointment_id=appt.id,
        number=await _next_number(db, appt.salon_id),
        status=InvoiceStatus.unpaid,
        subtotal=subtotal,
        discount=discount,
        gst=gst,
        total=round(subtotal - discount + gst, 2),
    )
    db.add(invoice)
    await db.flush()
    db.add(
        InvoiceLine(
            invoice_id=invoice.id,
            kind="service",
            name=service.name,
            qty=1,
            unit_price=service.price,
            gst_rate=service.gst_rate,
            line_total=totals[0],
            service_id=service.id,
            staff_user_id=appt.staff_user_id,
        )
    )
    await db.flush()
    return invoice


async def _mark_paid(db: DB, invoice: Invoice, method: str) -> None:
    if invoice.status == InvoiceStatus.paid:
        raise Conflict("This bill is already paid", code="already_paid")
    invoice.status = InvoiceStatus.paid
    invoice.pay_method = method
    invoice.paid_at = datetime.now(UTC)
    customer = await db.get(Customer, invoice.customer_id)
    if customer is not None:
        customer.loyalty_points = (customer.loyalty_points or 0) + int(_money(invoice.total) // 100)
        from app.services.notices import announce_payment

        await announce_payment(db, invoice, customer)


# ---------- Stock ----------


@router.get("/products", response_model=list[ProductOut])
async def list_products(user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> list[ProductOut]:
    require_role(user, *STOCK)
    salon = await ensure_salon_access(db, user, salon_id)
    rows = (
        await db.scalars(select(Product).where(Product.salon_id == salon.id).order_by(Product.category, Product.name))
    ).all()
    return [_product_out(row) for row in rows]


@router.post("/products", response_model=ProductOut, status_code=201)
async def create_product(body: ProductIn, user: CurrentUser, db: DB) -> ProductOut:
    require_role(user, *STOCK)
    salon = await ensure_salon_access(db, user, body.salon_id)
    row = Product(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        name=body.name,
        category=body.category,
        stock=body.stock,
        min_stock=body.min_stock,
        price=body.price,
        gst_rate=body.gst_rate,
        supplier=body.supplier,
    )
    db.add(row)
    await db.flush()
    return _product_out(row)


@router.patch("/products/{product_id}", response_model=ProductOut)
async def update_product(product_id: uuid.UUID, body: ProductPatch, user: CurrentUser, db: DB) -> ProductOut:
    require_role(user, *STOCK)
    row = await db.get(Product, product_id)
    if row is None:
        raise NotFound("Product not found")
    await ensure_salon_access(db, user, row.salon_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.flush()
    return _product_out(row)


# ---------- Invoices ----------


@router.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> list[InvoiceOut]:
    require_role(user, *BILLING)
    salon = await ensure_salon_access(db, user, salon_id)
    rows = (
        await db.scalars(
            select(Invoice).where(Invoice.salon_id == salon.id).order_by(Invoice.created_at.desc()).limit(200)
        )
    ).all()
    return [await _invoice_out(db, row) for row in rows]


@router.post("/invoices", response_model=InvoiceOut, status_code=201)
async def create_invoice(body: InvoiceIn, user: CurrentUser, db: DB) -> InvoiceOut:
    require_role(user, *BILLING)
    if body.pay_now and body.pay_method is None:
        raise Conflict("Choose how this bill is paid", code="pay_method_required")
    salon = await ensure_salon_access(db, user, body.salon_id)
    appointment = None
    if body.appointment_id:
        appointment = await db.get(Appointment, body.appointment_id)
        if appointment is None or appointment.salon_id != salon.id:
            raise NotFound("Appointment not found")
        existing = await db.scalar(select(Invoice.id).where(Invoice.appointment_id == appointment.id))
        if existing:
            raise Conflict("This visit already has a bill", code="already_billed")

    if body.customer_id:
        customer = await db.get(Customer, body.customer_id)
        if customer is None:
            raise NotFound("Customer not found")
    elif appointment is not None:
        customer = await db.get(Customer, appointment.customer_id)
    elif body.customer_name:
        customer = await reuse_or_create(db, salon, name=body.customer_name, phone=body.customer_phone)
    else:
        raise Conflict("Choose a customer or enter a name", code="customer_required")
    await claim_account(db, customer)
    if appointment is not None and customer.id != appointment.customer_id:
        raise Conflict("This visit belongs to a different customer", code="customer_mismatch")

    priced: list[tuple[float, float, float]] = []
    built: list[InvoiceLine] = []
    for item in body.lines:
        if item.kind == "service":
            service = await db.get(Service, item.ref_id)
            if service is None or service.salon_id != salon.id or not service.is_active:
                raise NotFound("Service not found")
            priced.append((float(service.price), item.qty, float(service.gst_rate)))
            seller = item.staff_user_id or body.staff_user_id
            if seller is None and appointment is not None and appointment.service_id == service.id:
                seller = appointment.staff_user_id
            splits = [{"staffUserId": str(share.staff_user_id), "percent": share.percent} for share in item.shares]
            if splits and abs(sum(share.percent for share in item.shares) - 100) > 0.01:
                raise Conflict("A split must add up to 100 percent", code="bad_split")
            built.append(
                InvoiceLine(
                    kind="service",
                    name=service.name,
                    qty=item.qty,
                    unit_price=service.price,
                    gst_rate=service.gst_rate,
                    line_total=0,
                    service_id=service.id,
                    staff_user_id=item.shares[0].staff_user_id if splits else seller,
                    splits=splits or None,
                )
            )
        else:
            product = await db.get(Product, item.ref_id)
            if product is None or product.salon_id != salon.id or not product.is_active:
                raise NotFound("Product not found")
            if product.stock < item.qty:
                raise Conflict(f"{product.name} only has {product.stock} left", code="out_of_stock")
            product.stock -= item.qty
            priced.append((float(product.price), item.qty, float(product.gst_rate)))
            built.append(
                InvoiceLine(
                    kind="product",
                    name=product.name,
                    qty=item.qty,
                    unit_price=product.price,
                    gst_rate=product.gst_rate,
                    line_total=0,
                    product_id=product.id,
                    staff_user_id=item.staff_user_id or body.staff_user_id,
                )
            )

    subtotal, discount, gst, totals = _price_lines(priced, body.discount_percent)
    for line, total in zip(built, totals, strict=True):
        line.line_total = total
    invoice = Invoice(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        customer_id=customer.id,
        appointment_id=appointment.id if appointment else None,
        number=await _next_number(db, salon.id),
        status=InvoiceStatus.unpaid,
        subtotal=subtotal,
        discount=discount,
        gst=gst,
        total=round(subtotal - discount + gst, 2),
    )
    db.add(invoice)
    await db.flush()
    for line in built:
        line.invoice_id = invoice.id
        db.add(line)
    await db.flush()
    if body.pay_now:
        await _mark_paid(db, invoice, body.pay_method)
    return await _invoice_out(db, invoice)


@router.get("/me/bills", response_model=list[InvoiceOut])
async def my_bills(user: CurrentUser, db: DB) -> list[InvoiceOut]:
    require_role(user, Role.customer)
    await attach_login(db, user)
    rows = (
        await db.scalars(
            select(Invoice)
            .join(Customer, Customer.id == Invoice.customer_id)
            .where(Customer.user_id == user.id)
            .order_by(Invoice.created_at.desc())
            .limit(50)
        )
    ).all()
    return [await _invoice_out(db, row) for row in rows]


@router.post("/me/bills/{invoice_id}/pay", response_model=InvoiceOut)
async def pay_my_bill(invoice_id: uuid.UUID, body: PayInvoiceIn, user: CurrentUser, db: DB) -> InvoiceOut:
    """The customer records UPI or card. Cash is still taken at the desk."""
    require_role(user, Role.customer)
    if body.pay_method == "cash":
        raise Conflict("Pay cash at the salon", code="pay_at_desk")
    await attach_login(db, user)
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise NotFound("Invoice not found")
    customer = await db.get(Customer, invoice.customer_id)
    if customer is None or customer.user_id != user.id:
        raise NotFound("Invoice not found")
    await _mark_paid(db, invoice, body.pay_method)
    return await _invoice_out(db, invoice)


@router.post("/invoices/{invoice_id}/pay", response_model=InvoiceOut)
async def pay_invoice(invoice_id: uuid.UUID, body: PayInvoiceIn, user: CurrentUser, db: DB) -> InvoiceOut:
    require_role(user, *BILLING)
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise NotFound("Invoice not found")
    await ensure_salon_access(db, user, invoice.salon_id)
    await _mark_paid(db, invoice, body.pay_method)
    return await _invoice_out(db, invoice)


@router.post("/invoices/{invoice_id}/lines", response_model=InvoiceOut)
async def add_invoice_lines(invoice_id: uuid.UUID, body: InvoiceLinesIn, user: CurrentUser, db: DB) -> InvoiceOut:
    """Add a service or product the customer took after the first bill was saved."""
    require_role(user, *BILLING)
    invoice = await db.get(Invoice, invoice_id)
    if invoice is None:
        raise NotFound("Invoice not found")
    salon = await ensure_salon_access(db, user, invoice.salon_id)
    appointment = await db.get(Appointment, invoice.appointment_id) if invoice.appointment_id else None
    existing = (await db.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == invoice.id))).all()
    priced = [(float(line.unit_price), line.qty, float(line.gst_rate)) for line in existing]
    for item in body.lines:
        if item.kind == "service":
            service = await db.get(Service, item.ref_id)
            if service is None or service.salon_id != salon.id or not service.is_active:
                raise NotFound("Service not found")
            seller = item.staff_user_id or body.staff_user_id
            if seller is None and appointment is not None:
                seller = appointment.staff_user_id
            splits = [{"staffUserId": str(share.staff_user_id), "percent": share.percent} for share in item.shares]
            if splits and abs(sum(share.percent for share in item.shares) - 100) > 0.01:
                raise Conflict("A split must add up to 100 percent", code="bad_split")
            line = InvoiceLine(
                invoice_id=invoice.id,
                kind="service",
                name=service.name,
                qty=item.qty,
                unit_price=service.price,
                gst_rate=service.gst_rate,
                line_total=0,
                service_id=service.id,
                staff_user_id=item.shares[0].staff_user_id if splits else seller,
                splits=splits or None,
            )
            priced.append((float(service.price), item.qty, float(service.gst_rate)))
        else:
            product = await db.get(Product, item.ref_id)
            if product is None or product.salon_id != salon.id or not product.is_active:
                raise NotFound("Product not found")
            if product.stock < item.qty:
                raise Conflict(f"{product.name} only has {product.stock} left", code="out_of_stock")
            product.stock -= item.qty
            line = InvoiceLine(
                invoice_id=invoice.id,
                kind="product",
                name=product.name,
                qty=item.qty,
                unit_price=product.price,
                gst_rate=product.gst_rate,
                line_total=0,
                product_id=product.id,
                staff_user_id=item.staff_user_id or body.staff_user_id,
            )
            priced.append((float(product.price), item.qty, float(product.gst_rate)))
        db.add(line)
        existing.append(line)
    discount_percent = 0 if invoice.subtotal == 0 else round(float(invoice.discount) / float(invoice.subtotal) * 100, 2)
    subtotal, discount, gst, totals = _price_lines(priced, discount_percent)
    invoice.subtotal = subtotal
    invoice.discount = discount
    invoice.gst = gst
    invoice.total = round(subtotal - discount + gst, 2)
    for line, total in zip(existing, totals, strict=True):
        line.line_total = total
    await db.flush()
    return await _invoice_out(db, invoice)


# ---------- Campaigns ----------


async def _matching_customers(db: DB, salon_id: uuid.UUID, audience: str) -> list[Customer]:
    customers = (await db.scalars(select(Customer).where(Customer.salon_id == salon_id))).all()
    if audience == "all":
        return list(customers)
    found = (
        await db.execute(
            select(Appointment).where(Appointment.customer_id.in_([row.id for row in customers] or [uuid.uuid4()]))
        )
    ).scalars().all() if customers else []
    grouped: dict[uuid.UUID, list[Appointment]] = defaultdict(list)
    for appt in found:
        grouped[appt.customer_id].append(appt)
    today = datetime.now(KOLKATA).date()
    now = datetime.now(UTC)
    open_status = {AppointmentStatus.booked, AppointmentStatus.confirmed, AppointmentStatus.checked_in, AppointmentStatus.in_service}
    picked = []
    for row in customers:
        history = grouped.get(row.id, [])
        completed = [appt for appt in history if appt.status in {AppointmentStatus.completed, AppointmentStatus.billed} and appt.starts_at <= now]
        upcoming = [appt for appt in history if appt.status in open_status and appt.starts_at >= now]
        last = max(completed, key=lambda appt: appt.starts_at) if completed else None
        days = (today - last.starts_at.astimezone(KOLKATA).date()).days if last else None
        until = _days_until_birthday(row.date_of_birth, today)
        if audience == "birthday" and until is not None and until <= 14:
            picked.append(row)
        elif audience == "due" and days is not None and days >= 21 and not upcoming:
            picked.append(row)
        elif audience == "recent" and days is not None and days <= 7:
            picked.append(row)
    return picked


def _campaign_out(row: Campaign) -> CampaignOut:
    return CampaignOut(
        id=row.id,
        salon_id=row.salon_id,
        name=row.name,
        channel=row.channel,
        audience=row.audience,
        message=row.message,
        status=row.status,
        recipient_count=row.recipient_count,
        sent_at=row.sent_at,
    )


@router.get("/campaigns", response_model=list[CampaignOut])
async def list_campaigns(user: CurrentUser, db: DB, salon_id: uuid.UUID = Query(alias="salonId")) -> list[CampaignOut]:
    require_role(user, *OFFICE)
    salon = await ensure_salon_access(db, user, salon_id)
    rows = (
        await db.scalars(select(Campaign).where(Campaign.salon_id == salon.id).order_by(Campaign.created_at.desc()))
    ).all()
    return [_campaign_out(row) for row in rows]


@router.post("/campaigns", response_model=CampaignOut, status_code=201)
async def create_campaign(body: CampaignIn, user: CurrentUser, db: DB) -> CampaignOut:
    require_role(user, *OFFICE)
    salon = await ensure_salon_access(db, user, body.salon_id)
    row = Campaign(
        tenant_id=salon.tenant_id,
        salon_id=salon.id,
        name=body.name,
        channel=body.channel,
        audience=body.audience,
        message=body.message,
        status="draft",
    )
    db.add(row)
    await db.flush()
    return _campaign_out(row)


@router.post("/campaigns/{campaign_id}/send", response_model=CampaignOut)
async def send_campaign(campaign_id: uuid.UUID, user: CurrentUser, db: DB) -> CampaignOut:
    """Count the real audience and mark the campaign sent. Nothing leaves the salon."""
    require_role(user, *OFFICE)
    row = await db.get(Campaign, campaign_id)
    if row is None:
        raise NotFound("Campaign not found")
    await ensure_salon_access(db, user, row.salon_id)
    if row.status == "sent":
        raise Conflict("This campaign was already recorded", code="already_sent")
    if row.audience not in AUDIENCES:
        raise Conflict("Choose an audience", code="bad_audience")
    people = await _matching_customers(db, row.salon_id, row.audience)
    row.recipient_count = len(people)
    row.status = "sent"
    row.sent_at = datetime.now(UTC)
    await db.flush()
    return _campaign_out(row)


# ---------- Reports ----------


@router.get("/reports", response_model=ReportsOut)
async def reports(
    user: CurrentUser,
    db: DB,
    salon_id: uuid.UUID | None = Query(None, alias="salonId"),
    days: int = Query(30, ge=7, le=180),
) -> ReportsOut:
    require_role(user, *OFFICE)
    if salon_id:
        salon = await ensure_salon_access(db, user, salon_id)
        salon_ids = [salon.id]
    else:
        from app.services.access import accessible_salon_ids

        salon_ids = await accessible_salon_ids(db, user, include_inactive=False)
    start = datetime.now(KOLKATA) - timedelta(days=days)
    paid = []
    if salon_ids:
        paid = (
            await db.execute(
                select(Invoice).where(
                    Invoice.salon_id.in_(salon_ids),
                    Invoice.status == InvoiceStatus.paid,
                    Invoice.paid_at >= start,
                )
            )
        ).scalars().all()
    invoice_ids = [row.id for row in paid]
    service_rows = []
    staff_rows = []
    if invoice_ids:
        service_rows = (
            await db.execute(
                select(InvoiceLine.name, func.coalesce(func.sum(InvoiceLine.line_total), 0))
                .where(InvoiceLine.invoice_id.in_(invoice_ids), InvoiceLine.kind == "service")
                .group_by(InvoiceLine.name)
                .order_by(func.sum(InvoiceLine.line_total).desc())
            )
        ).all()
        staff_user = aliased(User)
        staff_rows = (
            await db.execute(
                select(staff_user.full_name, func.count(), func.coalesce(func.sum(InvoiceLine.line_total), 0))
                .join(staff_user, staff_user.id == InvoiceLine.staff_user_id)
                .where(InvoiceLine.invoice_id.in_(invoice_ids))
                .group_by(staff_user.full_name)
                .order_by(func.sum(InvoiceLine.line_total).desc())
            )
        ).all()
    pay_labels = {"upi": "UPI", "cash": "Cash", "card": "Card"}
    methods = Counter(pay_labels.get(row.pay_method, row.pay_method or "Unpaid") for row in paid)
    customers = 0
    appointments = 0
    if salon_ids:
        customers = await db.scalar(select(func.count()).select_from(Customer).where(Customer.salon_id.in_(salon_ids))) or 0
        appointments = (
            await db.scalar(
                select(func.count()).select_from(Appointment).where(
                    Appointment.salon_id.in_(salon_ids), Appointment.starts_at >= start
                )
            )
            or 0
        )
    return ReportsOut(
        revenue_by_day=await revenue_by_day(db, salon_ids, days if days <= 31 else 30),
        services=[ReportPoint(name=name, revenue=_money(total)) for name, total in service_rows],
        staff=[ReportStaff(name=name, appointments=count, revenue=_money(total)) for name, count, total in staff_rows],
        payments=[
            ReportPay(
                name=name,
                value=_money(sum(row.total for row in paid if pay_labels.get(row.pay_method, row.pay_method or "Unpaid") == name)),
            )
            for name in methods
        ],
        revenue=_money(sum(float(row.total) for row in paid)),
        invoices=len(paid),
        customers=customers,
        appointments=appointments,
    )
