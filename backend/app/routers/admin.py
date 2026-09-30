"""Placeholder admin routes. Implemented in a later phase."""

from fastapi import APIRouter

from ..errors import AppError

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/dashboard")
async def dashboard():
    raise AppError(501, "not_implemented", "Admin dashboard API is not implemented yet")


@router.get("/stats")
async def stats():
    raise AppError(501, "not_implemented", "Admin stats API is not implemented yet")
