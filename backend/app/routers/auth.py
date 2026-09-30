"""Auth routes.

Customer, restaurant and delivery apps sign in with a phone number and an OTP.
The admin dashboard uses email and password, and never OTP.
"""

from fastapi import APIRouter, Depends, Request

from ..components.auth import service
from ..components.auth.dependencies import CurrentUser, authenticate
from ..components.auth.schemas import (
    AdminLoginBody,
    LogoutBody,
    RefreshBody,
    RequestOtpBody,
    VerifyOtpBody,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _client_context(request: Request) -> dict:
    """Behind a load balancer the socket address is the proxy, so prefer the
    forwarded address when one is present."""
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)

    return {"user_agent": request.headers.get("user-agent"), "ip": ip}


@router.post("/otp/request")
async def request_otp(body: RequestOtpBody):
    result = await service.request_login_otp(body.phone)

    return {"ok": True, **result}


@router.post("/otp/verify")
async def verify_otp(body: VerifyOtpBody, request: Request):
    result = await service.verify_login_otp(body.phone, body.code, body.role, **_client_context(request))

    return {"ok": True, **result}


@router.post("/admin/login")
async def admin_login(body: AdminLoginBody, request: Request):
    result = await service.login_with_password(body.email, body.password, **_client_context(request))

    return {"ok": True, **result}


@router.post("/refresh")
async def refresh(body: RefreshBody, request: Request):
    result = await service.refresh_session(body.refresh_token, **_client_context(request))

    return {"ok": True, **result}


@router.post("/logout")
async def logout(body: LogoutBody):
    await service.logout(body.refresh_token)

    return {"ok": True}


@router.get("/me")
async def me(user: CurrentUser = Depends(authenticate)):
    current = await service.get_current_user(user.id)

    return {"ok": True, "user": {**current, "role": user.role}}
