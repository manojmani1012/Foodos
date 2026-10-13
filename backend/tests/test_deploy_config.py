"""Settings that only matter once the API runs on Render against Neon.

Each test here stands for a failure that would otherwise show up for the first
time on a live deploy: a crash at boot, nobody able to sign in, or "today"
starting at 5:30 in the morning.
"""

import asyncpg
import pytest
from pydantic import ValidationError

from app.config import Settings, normalise_database_url

NEON_STYLE = (
    "postgresql://neondb_owner:secret@ep-quiet-lake-123456.ap-southeast-1.aws.neon.tech/neondb"
    "?sslmode=require&channel_binding=require"
)

REAL_SECRETS = {"jwt_access_secret": "x" * 40, "otp_pepper": "y" * 40}


class TestNeonConnectionString:
    def test_channel_binding_is_dropped_and_tls_is_kept(self):
        cleaned = normalise_database_url(NEON_STYLE)

        assert "channel_binding" not in cleaned
        assert "sslmode=require" in cleaned
        assert cleaned.startswith("postgresql://neondb_owner:secret@ep-quiet-lake-123456")

    async def test_a_neon_style_string_actually_connects(self, migrated_database):
        # The string Neon hands out, pointed at the local test server. Before
        # the fix, Postgres refused it: unrecognized parameter "channel_binding".
        url = normalise_database_url(f"{migrated_database}?channel_binding=require")

        connection = await asyncpg.connect(url)
        try:
            assert await connection.fetchval("select 1") == 1
        finally:
            await connection.close()

    def test_the_pooled_address_is_refused_with_the_fix(self):
        pooled = NEON_STYLE.replace("ep-quiet-lake-123456.", "ep-quiet-lake-123456-pooler.")

        with pytest.raises(ValueError, match="direct connection string"):
            normalise_database_url(pooled)

    def test_an_ordinary_local_url_is_unchanged(self):
        local = "postgresql://postgres:pw@127.0.0.1:5432/foodos"

        assert normalise_database_url(local) == local


class TestStaging:
    def test_staging_may_show_login_codes(self):
        settings = Settings(node_env="staging", expose_otp_in_response=True, **REAL_SECRETS)

        assert settings.expose_otp_in_response is True

    def test_production_never_shows_login_codes(self):
        settings = Settings(node_env="production", expose_otp_in_response=True, **REAL_SECRETS)

        assert settings.expose_otp_in_response is False

    def test_staging_still_demands_real_secrets(self):
        with pytest.raises(ValidationError, match="JWT_ACCESS_SECRET must be set"):
            Settings(node_env="staging", jwt_access_secret="", otp_pepper="y" * 40)

    def test_staging_is_strict_about_browser_origins(self):
        assert Settings(node_env="staging", **REAL_SECRETS).is_deployed is True
        assert Settings(node_env="development").is_deployed is False


class TestTimezone:
    async def test_the_app_pool_runs_on_india_time(self, pool):
        # The app's real pool, the one dashboard and earnings queries use. The
        # local server itself reports Asia/Calcutta, so getting Asia/Kolkata
        # back proves the pool set it rather than inheriting the server's.
        from app import database

        database.set_pool(None)
        try:
            app_pool = await database.connect_database()

            async with app_pool.acquire() as connection:
                assert await connection.fetchval("show timezone") == "Asia/Kolkata"
        finally:
            await database.disconnect_database()


    async def test_a_bare_connection_gets_india_time_from_the_database(self, migrated_database):
        # No timezone requested at all, as on Neon, whose proxy drops it. The
        # local server's own default is Asia/Calcutta, so Asia/Kolkata can only
        # come from the database default the migration sets.
        connection = await asyncpg.connect(migrated_database)
        try:
            assert await connection.fetchval("show timezone") == "Asia/Kolkata"

            # And it survives what the pool does between uses.
            await connection.execute("reset all")
            assert await connection.fetchval("show timezone") == "Asia/Kolkata"
        finally:
            await connection.close()


class TestMigrationChecksums:
    """A database migrated from a Windows checkout (CRLF files) must still boot
    on Render, which checks out the same files with LF endings."""

    async def test_a_checksum_recorded_from_a_windows_checkout_is_accepted(self, migrated_database):
        from db.migrate import load_migrations, migrate

        first = load_migrations()[0]
        windows_checksum = next(iter(first["legacy_checksums"]))

        connection = await asyncpg.connect(migrated_database)
        try:
            await connection.execute(
                "update schema_migrations set checksum = $2 where name = $1", first["name"], windows_checksum
            )

            assert await migrate(migrated_database) == 0, "nothing new to apply, and no refusal"

            # The record is brought up to date, so it is not re-checked next time.
            stored = await connection.fetchval("select checksum from schema_migrations where name = $1", first["name"])
            assert stored == first["checksum"]
        finally:
            await connection.close()

    async def test_a_migration_that_was_really_edited_is_still_refused(self, migrated_database):
        from db.migrate import load_migrations, migrate

        first = load_migrations()[0]

        connection = await asyncpg.connect(migrated_database)
        try:
            await connection.execute(
                "update schema_migrations set checksum = 'edited' where name = $1", first["name"]
            )

            with pytest.raises(RuntimeError, match="already applied but has been edited"):
                await migrate(migrated_database)
        finally:
            await connection.execute(
                "update schema_migrations set checksum = $2 where name = $1", first["name"], first["checksum"]
            )
            await connection.close()
