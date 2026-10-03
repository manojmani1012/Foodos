"""FastAPI application.

Error responses keep the same shape the apps already expect:
    {"ok": false, "code": "...", "message": "...", "details": {...}}
"""

import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .database import connect_database, disconnect_database, ping_database
from .errors import AppError
from .routers import admin, auth, customer, delivery, restaurant, webhooks

logger = logging.getLogger("foodos")

settings = get_settings()

# Phones reach the dev server over the LAN, where the IP varies by network.
LAN_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):\d+$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_database()
    yield
    await disconnect_database()


app = FastAPI(
    title="Foodos API",
    version="0.1.0",
    description="Backend for the Foodos customer, restaurant, delivery partner and admin apps.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=None if settings.is_production else LAN_ORIGIN.pattern,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def handle_app_error(request: Request, error: AppError) -> JSONResponse:
    body = {"ok": False, "code": error.code, "message": error.message}

    if error.details is not None:
        body["details"] = error.details

    return JSONResponse(status_code=error.status, content=body)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    fields: dict[str, str] = {}

    for issue in error.errors():
        # loc is like ("body", "code"); drop the leading "body".
        path = [str(part) for part in issue["loc"][1:]] or ["body"]
        fields.setdefault(".".join(path), issue["msg"])

    return JSONResponse(
        status_code=400,
        content={
            "ok": False,
            "code": "validation_failed",
            "message": "Check the details you entered",
            "details": {"fields": fields},
        },
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    # A bug or an outage: logged in full, reported as a plain 500 so nothing
    # internal reaches the caller.
    if not settings.is_test:
        logger.exception("[error] %s %s", request.method, request.url.path)

    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "code": "internal_error",
            "message": "Something went wrong. Please try again",
        },
    )


@app.get("/health", tags=["health"])
async def health():
    return {"ok": True, "service": "foodos-backend", "phase": "phase-2-backend-foundation"}


@app.get("/health/deep", tags=["health"])
async def health_deep():
    """Separate from /health so a load balancer check never fails on a database
    blip, while deploys still have a way to confirm the database is reachable."""
    try:
        database = await ping_database()
    except Exception as error:  # noqa: BLE001 - reported, not raised
        return JSONResponse(
            status_code=503,
            content={"ok": False, "database": {"connected": False, "reason": str(error)}},
        )

    return JSONResponse(
        status_code=200 if database["connected"] else 503,
        content={"ok": database["connected"], "database": database},
    )


@app.get("/api/v1", tags=["health"])
async def api_root():
    return {
        "ok": True,
        "message": "Foodos API is running",
        "routes": ["auth", "customer", "restaurant", "delivery", "admin"],
    }


app.include_router(auth.router)
app.include_router(customer.router)
app.include_router(restaurant.router)
app.include_router(delivery.router)
app.include_router(admin.router)
app.include_router(webhooks.router)


@app.exception_handler(404)
async def handle_not_found(request: Request, error) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"ok": False, "code": "not_found", "message": "Route not found", "path": request.url.path},
    )
