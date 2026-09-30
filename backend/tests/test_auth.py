"""Auth tests: OTP login, sessions and admin login.

Ported from the Node suite, plus a check that password hashes created by the
old backend still verify here.
"""

import pytest

from app.components.auth.passwords import hash_password, verify_password
from app.database import fetchrow, fetchval, execute

PHONE = "9876543210"
E164 = "+919876543210"


async def request_otp(client, phone: str = PHONE) -> str:
    response = await client.post("/api/v1/auth/otp/request", json={"phone": phone})

    assert response.status_code == 200, response.text

    return response.json()["devCode"]


async def sign_in(client, phone: str = PHONE, role: str = "customer") -> dict:
    code = await request_otp(client, phone)
    response = await client.post(
        "/api/v1/auth/otp/verify", json={"phone": phone, "code": code, "role": role}
    )

    assert response.status_code == 200, response.text

    return response.json()


async def clear_cooldown() -> None:
    """The cooldown blocks a second code within 30 seconds, which most tests do
    not want to wait for."""
    await execute("update otp_codes set created_at = created_at - interval '1 minute'")


class TestOtpRequest:
    async def test_stores_only_a_hash_never_the_code(self, client):
        code = await request_otp(client)

        row = await fetchrow("select phone, code_hash, attempts, consumed_at from otp_codes")

        assert await fetchval("select count(*) from otp_codes") == 1
        assert row["phone"] == E164, "a bare 10-digit number is stored as E.164"
        assert row["code_hash"] != code
        assert code not in row["code_hash"]
        assert row["attempts"] == 0
        assert row["consumed_at"] is None

    async def test_accepts_number_with_or_without_country_code(self, client):
        await request_otp(client, "+91 98765 43210")
        await clear_cooldown()
        await request_otp(client, "09876543210")

        rows = await fetchval("select count(distinct phone) from otp_codes")
        stored = await fetchval("select distinct phone from otp_codes")

        assert rows == 1
        assert stored == E164

    async def test_rejects_a_non_phone_number(self, client):
        response = await client.post("/api/v1/auth/otp/request", json={"phone": "not-a-number"})

        assert response.status_code == 400
        assert response.json()["code"] == "phone_invalid"

    async def test_refuses_resend_inside_cooldown(self, client):
        await request_otp(client)

        response = await client.post("/api/v1/auth/otp/request", json={"phone": PHONE})

        assert response.status_code == 429
        assert response.json()["code"] == "otp_cooldown"
        assert response.json()["details"]["retryAfterSeconds"] > 0

    async def test_stops_after_five_codes_in_an_hour(self, client):
        for _ in range(5):
            await request_otp(client)
            await clear_cooldown()

        response = await client.post("/api/v1/auth/otp/request", json={"phone": PHONE})

        assert response.status_code == 429
        assert response.json()["code"] == "otp_limit_reached"


class TestOtpVerification:
    async def test_creates_account_on_first_sign_in(self, client):
        body = await sign_in(client)

        assert body["isNewUser"] is True
        assert body["user"]["phone"] == E164
        assert body["user"]["role"] == "customer"
        assert body["user"]["roles"] == ["customer"]
        assert body["accessToken"]
        assert body["refreshToken"]
        assert await fetchval("select count(*) from users") == 1

    async def test_reuses_account_on_next_sign_in(self, client):
        first = await sign_in(client)
        await clear_cooldown()
        second = await sign_in(client)

        assert second["isNewUser"] is False
        assert second["user"]["id"] == first["user"]["id"]

    async def test_rejects_wrong_code_and_counts_the_attempt(self, client):
        code = await request_otp(client)
        wrong = "1111" if code == "0000" else "0000"

        response = await client.post(
            "/api/v1/auth/otp/verify", json={"phone": PHONE, "code": wrong, "role": "customer"}
        )

        assert response.status_code == 401
        assert response.json()["code"] == "otp_incorrect"
        assert await fetchval("select attempts from otp_codes") == 1

    async def test_locks_the_code_after_five_wrong_attempts(self, client):
        code = await request_otp(client)
        wrong = "1111" if code == "0000" else "0000"

        for _ in range(5):
            await client.post(
                "/api/v1/auth/otp/verify", json={"phone": PHONE, "code": wrong, "role": "customer"}
            )

        # Even the correct code is refused once the attempt budget is gone.
        response = await client.post(
            "/api/v1/auth/otp/verify", json={"phone": PHONE, "code": code, "role": "customer"}
        )

        assert response.status_code == 429
        assert response.json()["code"] == "otp_attempts_exceeded"

    async def test_refuses_an_expired_code(self, client):
        code = await request_otp(client)
        await execute("update otp_codes set expires_at = now() - interval '1 second'")

        response = await client.post(
            "/api/v1/auth/otp/verify", json={"phone": PHONE, "code": code, "role": "customer"}
        )

        assert response.status_code == 401
        assert response.json()["code"] == "otp_expired"

    async def test_refuses_a_code_a_second_time(self, client):
        code = await request_otp(client)

        await client.post(
            "/api/v1/auth/otp/verify", json={"phone": PHONE, "code": code, "role": "customer"}
        )
        response = await client.post(
            "/api/v1/auth/otp/verify", json={"phone": PHONE, "code": code, "role": "customer"}
        )

        assert response.status_code == 401
        assert response.json()["code"] in {"otp_not_found", "otp_already_used"}

    async def test_will_not_hand_out_admin_access_for_a_phone_number(self, client):
        code = await request_otp(client)

        response = await client.post(
            "/api/v1/auth/otp/verify", json={"phone": PHONE, "code": code, "role": "admin"}
        )

        assert response.status_code == 400
        assert response.json()["code"] == "validation_failed"
        assert (
            await fetchval(
                "select count(*) from user_roles where role in ('admin','super_admin')"
            )
            == 0
        )

    async def test_delivery_partner_still_needs_approval(self, client):
        await sign_in(client, role="delivery_partner")

        row = await fetchrow("select status, is_online from delivery_partners")

        assert row is not None
        assert row["status"] == "pending"
        assert row["is_online"] is False

    async def test_one_account_when_same_person_uses_two_apps(self, client):
        await sign_in(client, role="customer")
        await clear_cooldown()
        second = await sign_in(client, role="delivery_partner")

        assert sorted(second["user"]["roles"]) == ["customer", "delivery_partner"]
        assert await fetchval("select count(*) from users") == 1

    async def test_turns_away_a_blocked_account(self, client):
        await sign_in(client)
        await execute("update users set status = 'blocked'")
        await clear_cooldown()

        response = await client.post("/api/v1/auth/otp/request", json={"phone": PHONE})

        assert response.status_code == 403
        assert response.json()["code"] == "account_blocked"


class TestSessions:
    async def test_rejects_request_with_no_token(self, client):
        response = await client.get("/api/v1/auth/me")

        assert response.status_code == 401
        assert response.json()["code"] == "token_missing"

    async def test_rejects_a_tampered_token(self, client):
        session = await sign_in(client)
        tampered = session["accessToken"][:-2] + "xx"

        response = await client.get(
            "/api/v1/auth/me", headers={"authorization": f"Bearer {tampered}"}
        )

        assert response.status_code == 401
        assert response.json()["code"] == "token_invalid"

    async def test_returns_the_signed_in_user(self, client):
        session = await sign_in(client)

        response = await client.get(
            "/api/v1/auth/me", headers={"authorization": f"Bearer {session['accessToken']}"}
        )

        assert response.status_code == 200
        assert response.json()["user"]["id"] == session["user"]["id"]
        assert response.json()["user"]["phone"] == E164

    async def test_exchanges_refresh_token_for_a_new_pair(self, client):
        session = await sign_in(client)

        response = await client.post(
            "/api/v1/auth/refresh", json={"refreshToken": session["refreshToken"]}
        )

        assert response.status_code == 200
        assert response.json()["accessToken"]
        assert response.json()["refreshToken"] != session["refreshToken"], "the refresh token rotates"

        check = await client.get(
            "/api/v1/auth/me",
            headers={"authorization": f"Bearer {response.json()['accessToken']}"},
        )
        assert check.status_code == 200

    async def test_kills_the_session_when_a_rotated_token_is_replayed(self, client):
        session = await sign_in(client)

        rotated = await client.post(
            "/api/v1/auth/refresh", json={"refreshToken": session["refreshToken"]}
        )
        assert rotated.status_code == 200

        # A stolen copy of the original token being used again.
        replay = await client.post(
            "/api/v1/auth/refresh", json={"refreshToken": session["refreshToken"]}
        )

        assert replay.status_code == 401
        assert replay.json()["code"] == "refresh_token_reused"

        # The thief is out, and so is the real user: every token in the family dies.
        after_breach = await client.post(
            "/api/v1/auth/refresh", json={"refreshToken": rotated.json()["refreshToken"]}
        )
        assert after_breach.status_code == 401

    async def test_refuses_an_expired_refresh_token(self, client):
        session = await sign_in(client)
        await execute("update refresh_tokens set expires_at = now() - interval '1 second'")

        response = await client.post(
            "/api/v1/auth/refresh", json={"refreshToken": session["refreshToken"]}
        )

        assert response.status_code == 401
        assert response.json()["code"] == "refresh_token_expired"

    async def test_ends_the_session_on_logout(self, client):
        session = await sign_in(client)

        logged_out = await client.post(
            "/api/v1/auth/logout", json={"refreshToken": session["refreshToken"]}
        )
        assert logged_out.status_code == 200

        response = await client.post(
            "/api/v1/auth/refresh", json={"refreshToken": session["refreshToken"]}
        )
        assert response.status_code == 401

    async def test_stores_only_a_hash_of_the_refresh_token(self, client):
        session = await sign_in(client)

        stored = await fetchval("select token_hash from refresh_tokens")

        assert await fetchval("select count(*) from refresh_tokens") == 1
        assert stored != session["refreshToken"]


class TestAdminLogin:
    async def create_admin(
        self,
        email: str = "admin@foodos.in",
        password: str = "super-secret-1",
        role: str = "admin",
    ):
        user_id = await fetchval(
            "insert into users (email, full_name, password_hash) values ($1, $2, $3) returning id",
            email,
            "Admin",
            hash_password(password),
        )
        await execute("insert into user_roles (user_id, role) values ($1, $2)", user_id, role)

        return user_id

    async def test_signs_in_with_the_right_password(self, client):
        await self.create_admin()

        response = await client.post(
            "/api/v1/auth/admin/login",
            json={"email": "admin@foodos.in", "password": "super-secret-1"},
        )

        assert response.status_code == 200
        assert response.json()["user"]["role"] == "admin"
        assert response.json()["accessToken"]

    async def test_same_answer_for_wrong_password_and_unknown_email(self, client):
        await self.create_admin()

        wrong_password = await client.post(
            "/api/v1/auth/admin/login",
            json={"email": "admin@foodos.in", "password": "wrong-password"},
        )
        unknown_email = await client.post(
            "/api/v1/auth/admin/login",
            json={"email": "nobody@foodos.in", "password": "super-secret-1"},
        )

        assert wrong_password.status_code == 401
        assert unknown_email.status_code == 401
        assert wrong_password.json()["message"] == unknown_email.json()["message"]

    async def test_turns_away_a_customer_at_the_admin_door(self, client):
        user_id = await fetchval(
            "insert into users (email, password_hash) values ($1, $2) returning id",
            "shopper@foodos.in",
            hash_password("super-secret-1"),
        )
        await execute("insert into user_roles (user_id, role) values ($1, 'customer')", user_id)

        response = await client.post(
            "/api/v1/auth/admin/login",
            json={"email": "shopper@foodos.in", "password": "super-secret-1"},
        )

        assert response.status_code == 403
        assert response.json()["code"] == "role_not_allowed"


class TestPasswordCompatibility:
    def test_verifies_a_hash_created_by_the_node_backend(self):
        """Generated by the previous Node implementation for "super-secret-1".

        Both backends use scrypt with the same parameters and storage format, so
        existing admin accounts keep working after the move to Python.
        """
        node_hash = (
            "scrypt$16384$8$1$mTWZS2eXVYsAFWCEYAUydg==$"
            "ikjpyXH+h5GHj3Vvocau55aruPtPBVr7BYuOG16SpxMz7R7y8aj+iiVc38i+Lct+Rf2sUOcSZMxwEx0yRjTJZQ=="
        )

        assert verify_password("super-secret-1", node_hash) is True
        assert verify_password("wrong-password", node_hash) is False
