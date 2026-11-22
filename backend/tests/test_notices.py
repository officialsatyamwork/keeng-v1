import pytest

from app.services import email as mailer
from tests.conftest import API, PASSWORD, auth, invite_and_accept, register_owner

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _sent_to() -> list[str]:
    return [msg["To"].lower() for msg in mailer.outbox]


def _message_for(address: str):
    return next(msg for msg in reversed(mailer.outbox) if msg["To"].lower() == address.lower())


async def test_confirmation_reaches_every_role(client):
    owner = await register_owner(client, email="notice-owner@example.com", business="Notice Salon")
    salon_id = owner["user"]["salons"][0]["id"]
    owner_token = owner["accessToken"]
    desk = await invite_and_accept(
        client, owner_token, email="notice-desk@example.com", role="employee", salon_ids=[salon_id]
    )
    other = await invite_and_accept(
        client, owner_token, email="notice-staff@example.com", role="staff", salon_ids=[salon_id]
    )
    service = await client.post(
        f"{API}/services",
        headers=auth(desk["token"]),
        json={"salonId": salon_id, "name": "Haircut", "durationMinutes": 30, "price": 500},
    )
    assert service.status_code == 201, service.text
    customer = await client.post(
        f"{API}/auth/register/customer",
        json={
            "name": "Asha Rao",
            "email": "notice-customer@example.com",
            "phone": "9000007771",
            "password": PASSWORD,
            "dateOfBirth": "1994-06-15",
        },
    )
    assert customer.status_code == 201, customer.text
    customer_token = customer.json()["accessToken"]

    mailer.outbox.clear()
    booked = await client.post(
        f"{API}/appointments",
        headers=auth(customer_token),
        json={
            "salonId": salon_id,
            "serviceId": service.json()["id"],
            "startsAt": "2026-12-20T11:00:00+05:30",
            "staffUserId": desk["user"]["id"],
            "source": "online",
        },
    )
    assert booked.status_code == 201, booked.text
    sent = _sent_to()
    for address in (
        "notice-customer@example.com",
        "notice-owner@example.com",
        "notice-desk@example.com",
        "notice-staff@example.com",
    ):
        assert address in sent, sent
    confirmation = _message_for("notice-customer@example.com")
    assert confirmation["Subject"] == "Your appointment is confirmed"
    assert "Haircut" in confirmation.get_content()
    salon_copy = _message_for("notice-owner@example.com")
    assert salon_copy["Subject"].startswith("New booking:")

    async def titles(token: str) -> list[str]:
        found = await client.get(f"{API}/notifications", headers=auth(token))
        assert found.status_code == 200, found.text
        return [row["title"] for row in found.json()]

    assert "Booking confirmed" in await titles(customer_token)
    assert "Booking confirmed" in await titles(owner_token)
    assert "Booking confirmed" in await titles(desk["token"])
    assert "Booking confirmed" in await titles(other["token"])

    before = len(mailer.outbox)
    checked = await client.patch(
        f"{API}/appointments/{booked.json()['id']}",
        headers=auth(desk["token"]),
        json={"status": "checked_in"},
    )
    assert checked.status_code == 200, checked.text
    assert len(mailer.outbox) == before
    assert "Checked in" in await titles(customer_token)
    assert "Checked in" in await titles(other["token"])

    cancelled = await client.patch(
        f"{API}/appointments/{booked.json()['id']}",
        headers=auth(desk["token"]),
        json={"status": "cancelled"},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert _message_for("notice-customer@example.com")["Subject"] == "Your appointment was cancelled"
    assert "Booking cancelled" in await titles(owner_token)
    assert "Booking cancelled" in await titles(customer_token)

    prefs = await client.put(
        f"{API}/settings/notifications",
        headers=auth(owner_token),
        json={
            "appointmentReminders": True,
            "newBookings": False,
            "cancellations": True,
            "lowStock": True,
            "dailySummary": False,
            "weeklySummary": True,
        },
    )
    assert prefs.status_code == 200, prefs.text
    mailer.outbox.clear()
    desk_booking = await client.post(
        f"{API}/appointments",
        headers=auth(desk["token"]),
        json={
            "salonId": salon_id,
            "serviceId": service.json()["id"],
            "startsAt": "2026-12-21T15:00:00+05:30",
            "staffUserId": desk["user"]["id"],
            "customerName": "Walk In",
            "customerPhone": "9000007772",
            "customerEmail": "walkin@example.com",
        },
    )
    assert desk_booking.status_code == 201, desk_booking.text
    sent = _sent_to()
    assert sent == ["walkin@example.com"]
    assert "confirmed" in _message_for("walkin@example.com")["Subject"].lower()


async def test_confirm_sticks_once(client):
    """Confirm changes booked to confirmed, even if the stylist's shift no longer covers that time."""
    owner = await register_owner(client, email="confirm-owner@example.com", business="Confirm Salon")
    salon_id = owner["user"]["salons"][0]["id"]
    desk = await invite_and_accept(
        client, owner["accessToken"], email="confirm-desk@example.com", role="employee", salon_ids=[salon_id]
    )
    service = await client.post(
        f"{API}/services",
        headers=auth(desk["token"]),
        json={"salonId": salon_id, "name": "Haircut", "durationMinutes": 30, "price": 500},
    )
    assert service.status_code == 201, service.text
    booked = await client.post(
        f"{API}/appointments",
        headers=auth(desk["token"]),
        json={
            "salonId": salon_id,
            "serviceId": service.json()["id"],
            "startsAt": "2026-12-20T11:00:00+05:30",
            "staffUserId": desk["user"]["id"],
            "customerName": "Nia Confirm",
            "customerPhone": "9000007781",
            "customerEmail": "confirm-customer@example.com",
        },
    )
    assert booked.status_code == 201, booked.text
    shifts = await client.put(
        f"{API}/staff/{desk['user']['id']}/shifts",
        headers=auth(desk["token"]),
        json={"salonId": salon_id, "shifts": [{"weekday": 0, "startTime": "10:00", "endTime": "12:00"}]},
    )
    assert shifts.status_code == 200, shifts.text
    mailer.outbox.clear()
    confirmed = await client.patch(
        f"{API}/appointments/{booked.json()['id']}",
        headers=auth(desk["token"]),
        json={"status": "confirmed"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert _message_for("confirm-customer@example.com")["Subject"] == "Your appointment is confirmed"
    before = len(mailer.outbox)
    again = await client.patch(
        f"{API}/appointments/{booked.json()['id']}",
        headers=auth(desk["token"]),
        json={"status": "confirmed"},
    )
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "confirmed"
    assert len(mailer.outbox) == before
