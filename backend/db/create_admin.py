"""Creates an admin panel account, or resets an existing one's password.

    python -m db.create_admin --email ops@foodos.in --name "Priya Sharma"
    python -m db.create_admin --email owner@foodos.in --name "Owner" --super

The password is typed at a hidden prompt, never passed on the command line,
so it does not end up in shell history or in anyone's screenshot. Run it
against the live database by pointing DATABASE_URL at it first.
"""

import argparse
import asyncio
import getpass
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.components.auth.passwords import hash_password  # noqa: E402
from app.config import get_settings  # noqa: E402

MIN_PASSWORD_LENGTH = 10


def ask_password() -> str:
    while True:
        password = getpass.getpass(f"Password (at least {MIN_PASSWORD_LENGTH} characters, hidden as you type): ")

        if len(password) < MIN_PASSWORD_LENGTH:
            print(f"Too short. Use at least {MIN_PASSWORD_LENGTH} characters.")
            continue

        if password.isdigit() or password.isalpha():
            print("Mix letters with numbers or symbols.")
            continue

        if getpass.getpass("Type it again: ") != password:
            print("The two did not match. Try again.")
            continue

        return password


async def create_admin(email: str, name: str, super_admin: bool) -> None:
    settings = get_settings()

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    email = email.strip().lower()
    role = "super_admin" if super_admin else "admin"
    password_hash = hash_password(ask_password())

    connection = await asyncpg.connect(dsn=settings.database_url)

    try:
        async with connection.transaction():
            existing = await connection.fetchrow("select id from users where email = $1", email)

            if existing is None:
                user_id = await connection.fetchval(
                    "insert into users (email, full_name, password_hash) values ($1, $2, $3) returning id",
                    email,
                    name.strip(),
                    password_hash,
                )
                print(f"Created {email}")
            else:
                user_id = existing["id"]
                await connection.execute(
                    "update users set password_hash = $2, full_name = coalesce(full_name, $3), status = 'active' where id = $1",
                    user_id,
                    password_hash,
                    name.strip(),
                )
                # A new password ends every session signed in with the old one.
                await connection.execute(
                    "update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null",
                    user_id,
                )
                print(f"Updated the password for {email}")

            await connection.execute(
                "insert into user_roles (user_id, role) values ($1, $2) on conflict do nothing", user_id, role
            )
    finally:
        await connection.close()

    print(f"{email} can now sign in to the admin panel ({role.replace('_', ' ')}).")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Foodos admin panel account")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--super", action="store_true", help="a super admin, for the business owner")
    args = parser.parse_args()

    asyncio.run(create_admin(args.email, args.name, args.super))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled. Nothing was changed.")
        sys.exit(1)
    except Exception as error:  # noqa: BLE001 - top-level CLI reporting
        print(error)
        sys.exit(1)
