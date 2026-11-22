import pytest

from app.services import email as mailer
from tests.conftest import API, PASSWORD, auth, invite_and_accept, register_owner

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_one_customer_profile_across_the_platform(client):
    owner = await register_owner(client, email="dedupe-owner@example.com", business="Dedupe Salon")
    salon_id = owner["user"]["salons"][0]["id"]
    desk = await invite_and_accept(
        client, owner["accessToken"], email="dedupe-desk@example.com", role="employee", salon_ids=[salon_id]
    )
    token = desk["token"]
    service = await client.post(
        f"{API}/services",
        headers=auth(token),
        json={"salonId": salon_id, "name": "Haircut", "durationMinutes": 30, "price": 500},
    )
    assert service.status_code == 201, service.text

    created = await client.post(
        f"{API}/customers",
        headers=auth(token),
        json={"salonId": salon_id, "fullName": "Asha Rao", "phone": "9000000001", "email": "asha.rao@example.com"},
    )
    assert created.status_code == 201, created.text
    customer_id = created.json()["id"]

    same_phone = await client.post(
        f"{API}/customers",
        headers=auth(token),
        json={"salonId": salon_id, "fullName": "Asha R.", "phone": "9000000001", "email": "other@example.com"},
    )
    assert same_phone.status_code == 409, same_phone.text
    assert same_phone.json()["error"]["code"] == "customer_exists"
    assert "already a customer" in same_phone.json()["error"]["message"]

    same_email = await client.post(
        f"{API}/customers",
        headers=auth(token),
        json={"salonId": salon_id, "fullName": "Someone Else", "phone": "9000000002", "email": "Asha.Rao@example.com"},
    )
    assert same_email.status_code == 409, same_email.text

    booked = await client.post(
        f"{API}/appointments",
        headers=auth(token),
        json={
            "salonId": salon_id,
            "serviceId": service.json()["id"],
            "startsAt": "2026-12-15T11:00:00+05:30",
            "staffUserId": desk["user"]["id"],
            "customerName": "Asha Walk-in",
            "customerPhone": "9000000001",
        },
    )
    assert booked.status_code == 201, booked.text
    assert booked.json()["customerId"] == customer_id
    assert booked.json()["customerName"] == "Asha Rao"

    bill = await client.post(
        f"{API}/invoices",
        headers=auth(token),
        json={
            "salonId": salon_id,
            "customerName": "Another Name",
            "customerPhone": "9000000001",
            "payNow": True,
            "payMethod": "cash",
            "staffUserId": desk["user"]["id"],
            "lines": [{"kind": "service", "refId": service.json()["id"], "qty": 1}],
        },
    )
    assert bill.status_code == 201, bill.text
    assert bill.json()["customerId"] == customer_id
    assert bill.json()["customerName"] == "Asha Rao"

    listed = await client.get(f"{API}/customers?salonId={salon_id}", headers=auth(token))
    assert listed.status_code == 200, listed.text
    assert [row["id"] for row in listed.json() if row["phone"] == "9000000001"] == [customer_id]

    other = await register_owner(client, email="dedupe-other@example.com", business="Other Salon")
    other_salon = other["user"]["salons"][0]["id"]
    other_desk = await invite_and_accept(
        client, other["accessToken"], email="dedupe-other-desk@example.com", role="employee", salon_ids=[other_salon]
    )
    other_token = other_desk["token"]
    blocked = await client.post(
        f"{API}/customers",
        headers=auth(other_token),
        json={"salonId": other_salon, "fullName": "Asha Again", "phone": "9000000001"},
    )
    assert blocked.status_code == 409, blocked.text

    other_service = await client.post(
        f"{API}/services",
        headers=auth(other_token),
        json={"salonId": other_salon, "name": "Colour", "durationMinutes": 45, "price": 900},
    )
    assert other_service.status_code == 201, other_service.text
    visit = await client.post(
        f"{API}/appointments",
        headers=auth(other_token),
        json={
            "salonId": other_salon,
            "serviceId": other_service.json()["id"],
            "startsAt": "2026-12-16T12:00:00+05:30",
            "staffUserId": other_desk["user"]["id"],
            "customerName": "Asha Again",
            "customerPhone": "9000000001",
        },
    )
    assert visit.status_code == 201, visit.text
    assert visit.json()["customerId"] == customer_id
    seen = await client.get(f"{API}/customers?salonId={other_salon}", headers=auth(other_token))
    assert [row["id"] for row in seen.json() if row["phone"] == "9000000001"] == [customer_id]


async def test_desk_booking_shows_on_the_customer_login(client):
    """A visit saved by the salon shows for the customer who uses that phone."""
    owner = await register_owner(client, email="link-owner@example.com", business="Link Salon")
    salon_id = owner["user"]["salons"][0]["id"]
    desk = await invite_and_accept(
        client, owner["accessToken"], email="link-desk@example.com", role="manager", salon_ids=[salon_id]
    )
    stylist = await invite_and_accept(
        client, owner["accessToken"], email="link-stylist@example.com", role="employee", salon_ids=[salon_id]
    )
    service = await client.post(
        f"{API}/services",
        headers=auth(desk["token"]),
        json={"salonId": salon_id, "name": "Haircut", "durationMinutes": 45, "price": 2000},
    )
    assert service.status_code == 201, service.text
    service_id = service.json()["id"]

    booked_first = await client.post(
        f"{API}/appointments",
        headers=auth(desk["token"]),
        json={
            "salonId": salon_id,
            "serviceId": service_id,
            "startsAt": "2026-12-18T20:00:00+05:30",
            "staffUserId": stylist["user"]["id"],
            "customerName": "customer 1",
            "customerPhone": "9000003331",
            "customerEmail": "link-customer@example.com",
        },
    )
    assert booked_first.status_code == 201, booked_first.text
    mailer.outbox.clear()
    registered = await client.post(
        f"{API}/auth/register/customer",
        json={
            "name": "customer 1",
            "email": "link-customer@example.com",
            "phone": "9000003331",
            "password": PASSWORD,
            "dateOfBirth": "1996-04-02",
        },
    )
    assert registered.status_code == 201, registered.text
    token = registered.json()["accessToken"]
    assert not any(msg["To"].lower() == "link-customer@example.com" for msg in mailer.outbox)

    mine = await client.get(f"{API}/appointments", headers=auth(token))
    assert mine.status_code == 200, mine.text
    assert [row["serviceName"] for row in mine.json()] == ["Haircut"]
    bell = await client.get(f"{API}/notifications", headers=auth(token))
    assert bell.status_code == 200, bell.text
    assert any(row["title"] == "Booking confirmed" for row in bell.json())

    later = await client.post(
        f"{API}/appointments",
        headers=auth(desk["token"]),
        json={
            "salonId": salon_id,
            "serviceId": service_id,
            "startsAt": "2026-12-19T18:00:00+05:30",
            "staffUserId": stylist["user"]["id"],
            "customerId": booked_first.json()["customerId"],
        },
    )
    assert later.status_code == 201, later.text
    again = await client.get(f"{API}/appointments", headers=auth(token))
    assert again.status_code == 200, again.text
    assert len(again.json()) == 2
    home = await client.get(f"{API}/dashboard", headers=auth(token))
    assert home.status_code == 200, home.text
    assert home.json()["cards"][0]["value"] == 2
