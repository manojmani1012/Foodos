"""Creates the first admin for the dashboard.

There is no admin sign-up screen on purpose, so the only ways in are this script
and an existing admin.

    python -m db.create_admin you@example.com "a strong password" "Your Name"

Leave the password off and it is asked for, which keeps it out of shell history.
"""

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


async def main() -> None:
    args = sys.argv[1:]
    email = (args[0] if args else "").strip().lower()

    if "@" not in email:
        raise RuntimeError('Usage: python -m db.create_admin <email> [password] ["full name"]')

    password = args[1] if len(args) > 1 else getpass.getpass("Password (at least 8 characters): ")
    full_name = args[2] if len(args) > 2 else "Admin"

    if not password or len(password) < 8:
        raise RuntimeError("Password must be at least 8 characters")

    password_hash = hash_password(password)
    settings = get_settings()

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    connection = await asyncpg.connect(dsn=settings.database_url)

    try:
        async with connection.transaction():
            existing = await connection.fetchrow("select id from users where email = $1", email)

            if existing is not None:
                user_id = existing["id"]
                await connection.execute(
                    "update users set password_hash = $1, status = 'active' where id = $2",
                    password_hash,
                    user_id,
                )
                print(f"Updated the password for {email}")
            else:
                user_id = await connection.fetchval(
                    """
                    insert into users (email, full_name, password_hash)
                    values ($1, $2, $3) returning id
                    """,
                    email,
                    full_name,
                    password_hash,
                )
                print(f"Created {email}")

            await connection.execute(
                """
                insert into user_roles (user_id, role) values ($1, 'super_admin')
                on conflict do nothing
                """,
                user_id,
            )

        print(f"{email} can now sign in to the admin dashboard (user {user_id}).")
    finally:
        await connection.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:  # noqa: BLE001 - top-level CLI reporting
        print(error)
        sys.exit(1)
