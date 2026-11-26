"""Request bodies for Help & support."""

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Topic = Literal[
    "order_late",
    "order_wrong",
    "food_quality",
    "payment_refund",
    "delivery_partner",
    "payouts",
    "app_problem",
    "account",
    "other",
]


class TicketMessageBody(BaseModel):
    message: str = Field(min_length=1, max_length=1000)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()

        if not value:
            raise ValueError("Write a message")

        return value


class CreateTicketBody(TicketMessageBody):
    topic: Topic
    orderId: Optional[str] = None
