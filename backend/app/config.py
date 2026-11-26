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

    # Rider pay, commission and the payout schedule are edited in the admin
    # panel (Finance > Settings) and kept in the database: see
    # components/payouts/settings.py.

    # Customers see, and can order from, restaurants within this distance of
    # their pin. A restaurant can have its own radius, set in the admin panel.
    delivery_radius_km: float = Field(default=7.0, gt=0, le=30)

    # An order the restaurant has not accepted in this time is cancelled, and
    # refunded if paid. An online order left unpaid is dropped after the second.
    restaurant_accept_minutes: int = Field(default=5, ge=1)
    unpaid_order_minutes: int = Field(default=30, ge=5)

    # Dispatch offers each delivery to the nearest free rider, one at a time,
    # for offer_seconds. The search widens through these radii, one step every
    # ring_minutes. Riders whose last position is older than the freshness
    # limit are not offered anything: they may have closed the app.
    dispatch_offer_seconds: int = Field(default=30, ge=10)
    dispatch_radii_km: str = "3,5,8"
    dispatch_ring_minutes: float = Field(default=2, gt=0)
    rider_location_fresh_seconds: int = Field(default=180, ge=30)

    # Riders can mark "reached the restaurant" and "arrived at the customer"
    # only within this distance of the pin.
    geofence_metres: int = Field(default=100, ge=20)

    # "High demand" on a restaurant: this many orders waiting in its kitchen
    # (new or cooking). Its delivery time is shown that many minutes longer.
    high_demand_open_orders: int = Field(default=5, ge=1)
    high_demand_extra_minutes: int = Field(default=10, ge=0)

    # A rider holding this much cash from cash-on-delivery orders gets only
    # prepaid orders until they hand it over to Foodos. 0 turns the limit off.
    rider_cash_limit_paise: int = Field(default=200000, ge=0)

    # Foodos wallet. It only pays for orders on Foodos (a closed wallet), and
    # the balance is capped so it stays a small prepaid balance.
    wallet_max_balance_paise: int = Field(default=1000000, ge=0)
    wallet_min_topup_paise: int = Field(default=10000, ge=100)
    wallet_max_topup_paise: int = Field(default=500000, ge=100)

    # Which orders need the customer's 4-digit code before the rider can mark
    # them delivered.
    delivery_code_required: Literal["all", "prepaid", "off"] = "all"

    # The GST invoice. Food ordered through an app is taxed under section 9(5),
    # so Foodos issues the invoice for the restaurant, with its own legal name,
    # address and GSTIN. Placeholders until the client sends them; a blank
    # GSTIN is left off the invoice.
    # Who runs Foodos, for the policy pages (/legal/...), the Contact page and
    # the apps' Help screens. Left empty, the pages show a placeholder such as
    # "[Company legal name]" until the client sends its registered details.
    company_legal_name: str = ""
    company_address: str = ""
    company_jurisdiction: str = "Chennai, Tamil Nadu"
    support_email: str = ""
    support_phone: str = ""
    support_hours: str = ""
    grievance_officer_name: str = ""
    grievance_officer_email: str = ""

    invoice_company_name: str = "Foodos"
    invoice_company_address: str = ""
    invoice_company_gstin: str = ""
    invoice_place_of_supply: str = "Tamil Nadu (33)"

    # The background loop that expires offers, dispatches riders and cancels
    # unanswered orders. Off in tests, which call each step directly.
    background_jobs_enabled: bool = True
    background_interval_seconds: int = Field(default=10, ge=2)

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
    def dispatch_radii(self) -> list[float]:
        return [float(part) for part in self.dispatch_radii_km.split(",") if part.strip()] or [5.0]

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
