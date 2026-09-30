"""Test fixtures.

These run the real migrations against a throwaway `foodos_test` database on the
local PostgreSQL server, so constraints and SQL behave exactly as in production.

Loop scoping note: pytest-asyncio runs each test in its own event loop, and an
asyncpg pool is bound to the loop that created it. So the database is created
and migrated once per session (leaving no open connections behind), while the
pool itself is opened and closed per test.
"""

import os

# Set before any app module is imported: settings are cached on first read.
os.environ["NODE_ENV"] = "test"
os.environ["JWT_ACCESS_SECRET"] = "test-access-secret"
os.environ["OTP_PEPPER"] = "test-otp-pepper"
os.environ["EXPOSE_OTP_IN_RESPONSE"] = "true"
os.environ["SMS_PROVIDER"] = "console"

import asyncio  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402
from urllib.parse import urlsplit, urlunsplit  # noqa: E402

import asyncpg  # noqa: E402
import pytest  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app import database  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from db.migrate import migrate  # noqa: E402

TEST_DB_NAME = "foodos_test"

# Tables the tests write to, emptied between cases. `cascade` reaches the
# dependent rows (menu categories, items, add-ons, favourites), so they are not
# listed individually.
TRUNCATE_SQL = (
    "truncate refresh_tokens, user_roles, delivery_partners, otp_codes, "
    "restaurants, offers, orders, customer_addresses, users cascade"
)


def _swap_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{name}", parts.query, parts.fragment))


def _require_database_url() -> str:
    settings = get_settings()

    if not settings.database_url:
        pytest.skip("DATABASE_URL is not configured; start PostgreSQL and create backend/.env")

    return settings.database_url


async def _recreate_database(admin_url: str) -> None:
    connection = await asyncpg.connect(dsn=admin_url)
    try:
        await connection.execute(f'drop database if exists "{TEST_DB_NAME}" with (force)')
        await connection.execute(f'create database "{TEST_DB_NAME}"')
    finally:
        await connection.close()


async def _drop_database(admin_url: str) -> None:
    connection = await asyncpg.connect(dsn=admin_url)
    try:
        await connection.execute(f'drop database if exists "{TEST_DB_NAME}" with (force)')
    finally:
        await connection.close()


@pytest.fixture(scope="session")
def migrated_database() -> str:
    """Recreates the test database and applies every migration, once per run.

    Deliberately a synchronous fixture driving asyncio.run: it owns its own
    short-lived loop, so nothing it opens outlives the setup and conflicts with
    the per-test loops below.
    """
    database_url = _require_database_url()
    admin_url = _swap_database(database_url, "postgres")
    test_url = _swap_database(database_url, TEST_DB_NAME)

    asyncio.run(_recreate_database(admin_url))
    asyncio.run(migrate(test_url))

    yield test_url

    asyncio.run(_drop_database(admin_url))


@pytest.fixture
async def pool(migrated_database: str):
    """A pool on this test's event loop, wired into the app for the test."""
    test_pool = await asyncpg.create_pool(dsn=migrated_database, min_size=1, max_size=5)
    database.set_pool(test_pool)

    await test_pool.execute(TRUNCATE_SQL)

    yield test_pool

    database.set_pool(None)
    await test_pool.close()


@pytest.fixture
async def client(pool):
    # The app's own lifespan would open a second pool, so drive it through ASGI
    # directly and let the fixture above own the connection.
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
