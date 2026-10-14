"""Application settings, loaded from the environment and validated once at import."""

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Connection-string options that are meant for libpq (psql and friends) but
# that asyncpg would forward to the server as settings, which Postgres then
# rejects. Neon puts channel_binding=require in every string it hands out, so
# leaving this in stops every connection. TLS is unaffected: sslmode stays.
LIBPQ_ONLY_OPTIONS = {"channel_binding", "gssencmode", "target_session_attrs"}


def normalise_database_url(url: str) -> str:
    if not url:
        return url

    parts = urlsplit(url)

    # Neon's pooled address runs PgBouncer in transaction mode. The migration
    # lock (pg_advisory_lock) is held per session, which that mode does not
    # keep, so two deploys could migrate at once. Refuse it with the fix.
    if "-pooler." in (parts.hostname or ""):
        raise ValueError(
            "DATABASE_URL uses Neon's pooled address (-pooler). Use the direct "
            "connection string instead: in Neon, turn off 'Connection pooling' "
            "before copying it."
        )

    query = [(key, value) for key, value in parse_qsl(parts.query) if key not in LIBPQ_ONLY_OPTIONS]

    return urlunsplit(parts._replace(query=urlencode(query)))


DEV_FALLBACKS = {
    "jwt_access_secret": "dev-only-access-secret-do-not-use-in-production",
    "otp_pepper": "dev-only-otp-pepper-do-not-use-in-production",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # staging is a public deployment for testers: real secrets, as strict as
    # production, except that login codes may be shown on screen while no SMS
    # provider is connected. production never shows them.
    node_env: Literal["development", "test", "staging", "production"] = "development"
    port: int = 4000
    database_url: str = ""

    # Every connection's clock. "Today" on the restaurant dashboard and the
    # day-by-day earnings follow it, so it must be the restaurants' own time
    # zone, not whatever the database server happens to run (Neon runs UTC).
    database_timezone: str = "Asia/Kolkata"

    # Browsers block cross-origin calls unless the API allows the origin. The Vite
    # dev server runs on 5173, on this machine and over the local network.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    jwt_access_secret: str = ""
    jwt_issuer: str = "foodos"
    jwt_audience: str = "foodos-app"
    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_seconds: int = 30 * 24 * 60 * 60

    otp_pepper: str = ""
    otp_length: int = 4  # the login screens show four boxes
    otp_ttl_seconds: int = 5 * 60
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 30
    otp_max_per_hour: int = 5

    # Returns the OTP in the API response so the apps work without an SMS
    # provider. Forced off in production by the validator below.
    expose_otp_in_response: bool = False

    sms_provider: str = "console"
    default_country_code: str = "+91"

    # Razorpay. The secret is server-side only and never sent to the app.
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    # Push notifications go through Expo's push service, which needs no key.
    # An access token is optional: set one (expo.dev > Access tokens) and turn
    # on "enhanced push security" there so only this server can send.
    push_enabled: bool = True
    expo_access_token: str = ""

    # Rider pay per delivery: a base amount plus a rate per km travelled
    # (rider to restaurant, then restaurant to customer), and every rupee of
    # the customer's tip. Placeholders until the client sets real numbers.
    rider_base_pay_paise: int = Field(default=2500, ge=0)
    rider_pay_per_km_paise: int = Field(default=600, ge=0)

    database_pool_min: int = Field(default=1, ge=1)
    database_pool_max: int = Field(default=10, ge=1)

    @property
    def is_production(self) -> bool:
        return self.node_env == "production"

    @property
    def is_deployed(self) -> bool:
        """Reachable from the internet: secrets must be real and CORS strict."""
        return self.node_env in ("staging", "production")

    @field_validator("database_url")
    @classmethod
    def _normalise_database_url(cls, value: str) -> str:
        return normalise_database_url(value)

    @property
    def is_test(self) -> bool:
        return self.node_env == "test"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def _check_secrets(self) -> "Settings":
        # Secrets must be set explicitly in production. In development we fall
        # back to a fixed string so the server still boots, but say so loudly.
        for field, fallback in DEV_FALLBACKS.items():
            if getattr(self, field):
                continue

            if self.is_deployed:
                raise ValueError(f"{field.upper()} must be set when NODE_ENV={self.node_env}")

            object.__setattr__(self, field, fallback)
            print(f"[config] {field.upper()} is not set; using an insecure development default")

        if self.is_production and self.expose_otp_in_response:
            object.__setattr__(self, "expose_otp_in_response", False)

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
