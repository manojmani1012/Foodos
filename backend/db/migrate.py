"""Applies the SQL migrations in db/migrations, once each, in filename order.

Run with:  python -m db.migrate
"""

import asyncio
import hashlib
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

# Arbitrary constant: concurrent deploys (several containers starting together)
# queue on this lock instead of applying the same migration twice.
MIGRATION_LOCK_ID = 727274


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_migrations() -> list[dict]:
    """Reads every migration, with a checksum that ignores line endings.

    Git stores these files with LF endings, but a Windows checkout turns them
    into CRLF. Hashing the raw bytes made the same migration look edited
    depending on which machine ran it: a database migrated from Windows was
    refused by the Linux server on Render. Normalising to LF first means one
    file has one checksum everywhere.
    """
    migrations = []

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        sql = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        migrations.append(
            {
                "name": path.name,
                "sql": sql,
                "checksum": _sha256(sql),
                # What older versions of this script stored, from either kind
                # of checkout. Matching one of these is not an edit.
                "legacy_checksums": {_sha256(sql.replace("\n", "\r\n"))},
            }
        )

    return migrations


async def migrate(database_url: str) -> int:
    connection = await asyncpg.connect(dsn=database_url)

    try:
        await connection.execute("select pg_advisory_lock($1)", MIGRATION_LOCK_ID)
        await connection.execute(
            """
            create table if not exists schema_migrations (
              name text primary key,
              checksum text not null,
              applied_at timestamptz not null default now()
            )
            """
        )

        applied = {
            row["name"]: row["checksum"]
            for row in await connection.fetch("select name, checksum from schema_migrations")
        }

        count = 0

        for migration in load_migrations():
            previous = applied.get(migration["name"])

            if previous is not None:
                if previous in migration["legacy_checksums"]:
                    # Same migration, recorded before checksums ignored line
                    # endings. Bring the record up to date and move on.
                    await connection.execute(
                        "update schema_migrations set checksum = $2 where name = $1",
                        migration["name"],
                        migration["checksum"],
                    )
                    continue

                if previous != migration["checksum"]:
                    raise RuntimeError(
                        f"{migration['name']} was already applied but has been edited; "
                        "add a new migration instead"
                    )
                continue

            print(f"Applying {migration['name']}")

            try:
                async with connection.transaction():
                    await connection.execute(migration["sql"])
                    await connection.execute(
                        "insert into schema_migrations (name, checksum) values ($1, $2)",
                        migration["name"],
                        migration["checksum"],
                    )
            except Exception as error:
                raise RuntimeError(f"{migration['name']} failed: {error}") from error

            count += 1

        print("Database is up to date" if count == 0 else f"Applied {count} migration(s)")

        return count
    finally:
        await connection.execute("select pg_advisory_unlock($1)", MIGRATION_LOCK_ID)
        await connection.close()


async def main() -> None:
    settings = get_settings()

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    await migrate(settings.database_url)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:  # noqa: BLE001 - top-level CLI reporting
        print(error)
        sys.exit(1)
