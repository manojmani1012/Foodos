"""Placeholder delivery partner routes. Implemented in a later phase."""

from fastapi import APIRouter

from ..errors import AppError

router = APIRouter(prefix="/api/v1/delivery", tags=["delivery"])


@router.get("/dashboard")
async def dashboard():
    raise AppError(501, "not_implemented", "Delivery dashboard API is not implemented yet")


@router.get("/requests")
async def requests():
    raise AppError(501, "not_implemented", "Delivery requests API is not implemented yet")
