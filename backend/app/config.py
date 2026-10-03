"""Application settings, loaded from the environment and validated once at import."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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

    node_env: Literal["development", "test", "production"] = "development"
    port: int = 4000
    database_url: str = ""

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

    database_pool_min: int = Field(default=1, ge=1)
    database_pool_max: int = Field(default=10, ge=1)

    @property
    def is_production(self) -> bool:
        return self.node_env == "production"

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

            if self.is_production:
                raise ValueError(f"{field.upper()} must be set when NODE_ENV=production")

            object.__setattr__(self, field, fallback)
            print(f"[config] {field.upper()} is not set; using an insecure development default")

        if self.is_production and self.expose_otp_in_response:
            object.__setattr__(self, "expose_otp_in_response", False)

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
