"""Request bodies for the auth endpoints.

normalize_phone does the real parsing; these only reject obvious junk early.
"""

from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class RequestOtpBody(BaseModel):
    phone: str = Field(min_length=6, max_length=20)


class VerifyOtpBody(BaseModel):
    phone: str = Field(min_length=6, max_length=20)
    code: str = Field(pattern=r"^\d{4,8}$", description="Enter the code from the SMS")
    role: Literal["customer", "restaurant_owner", "delivery_partner"]


class AdminLoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RefreshBody(BaseModel):
    refresh_token: str = Field(min_length=20, alias="refreshToken")


class LogoutBody(BaseModel):
    refresh_token: str = Field(min_length=20, alias="refreshToken")
