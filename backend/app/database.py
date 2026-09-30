"""asyncpg connection pool and query helpers.

asyncpg uses the same $1, $2 placeholders as the previous Node backend, so the
SQL throughout the app is unchanged.
"""

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

import asyncpg

from .config import get_settings

_pool: Optional[asyncpg.Pool] = None


async def connect_database() -> Optional[asyncpg.Pool]:
    """Opens the pool. Called once on startup."""
    global _pool

    settings = get_settings()

    if not settings.database_url:
        return None

    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=settings.database_pool_min,
            max_size=settings.database_pool_max,
        )

    return _pool


async def disconnect_database() -> None:
    global _pool

    if _pool is not None:
        await _pool.close()
        _pool = None


def set_pool(pool: Optional[asyncpg.Pool]) -> None:
    """Lets the tests point the app at a throwaway database."""
    global _pool
    _pool = pool


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DATABASE_URL is not configured")

    return _pool


async def fetch(sql: str, *args: Any) -> list[asyncpg.Record]:
    return await get_pool().fetch(sql, *args)


async def fetchrow(sql: str, *args: Any) -> Optional[asyncpg.Record]:
    return await get_pool().fetchrow(sql, *args)


async def fetchval(sql: str, *args: Any) -> Any:
    return await get_pool().fetchval(sql, *args)


async def execute(sql: str, *args: Any) -> str:
    return await get_pool().execute(sql, *args)


@asynccontextmanager
async def transaction() -> AsyncIterator[asyncpg.Connection]:
    """Runs a block inside a transaction, rolling back if it raises.

    Every statement in the block must use the yielded connection, not the
    module-level helpers, or it will run outside the transaction.
    """
    async with get_pool().acquire() as connection:
        async with connection.transaction():
            yield connection


async def ping_database() -> dict[str, Any]:
    if _pool is None:
        return {"connected": False, "reason": "DATABASE_URL is not configured"}

    server_time = await _pool.fetchval("select now()")

    return {"connected": True, "serverTime": server_time.isoformat() if server_time else None}
