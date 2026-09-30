"""Placeholder restaurant routes. Implemented in a later phase."""

from fastapi import APIRouter

from ..errors import AppError

router = APIRouter(prefix="/api/v1/restaurant", tags=["restaurant"])


@router.get("/dashboard")
async def dashboard():
    raise AppError(501, "not_implemented", "Restaurant dashboard API is not implemented yet")


@router.get("/orders")
async def orders():
    raise AppError(501, "not_implemented", "Restaurant orders API is not implemented yet")
