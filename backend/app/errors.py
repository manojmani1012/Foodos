"""Deliberate, client-facing errors.

Anything raised as AppError reaches the caller as-is. Every other exception
becomes a plain 500, so an unexpected failure never leaks a stack trace or a
database message.
"""

from typing import Any


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def bad_request(code: str, message: str, details: Any = None) -> AppError:
    return AppError(400, code, message, details)


def unauthorized(code: str, message: str) -> AppError:
    return AppError(401, code, message)


def forbidden(code: str, message: str) -> AppError:
    return AppError(403, code, message)


def not_found(code: str, message: str) -> AppError:
    return AppError(404, code, message)


def conflict(code: str, message: str) -> AppError:
    return AppError(409, code, message)


def too_many_requests(code: str, message: str, details: Any = None) -> AppError:
    return AppError(429, code, message, details)
