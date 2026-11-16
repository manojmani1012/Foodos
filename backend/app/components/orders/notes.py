"""The notes a customer leaves at checkout, split by who reads them.

The kitchen sees the cooking instructions and "no cutlery"; the rider sees the
delivery preferences. Both apps already show one free-text note, so each gets
its part written out as a sentence, and older orders' single note still shows
to both.
"""

from typing import Any, Optional

DELIVERY_PREFERENCES = {
    "leave_at_door": "Leave the order at the door",
    "no_bell": "Do not ring the bell",
    "no_call": "Avoid calling",
    "pet_at_home": "Pet at home",
}


def kitchen_note(cooking: Optional[str], no_cutlery: bool, legacy: Optional[str] = None) -> Optional[str]:
    parts = [cooking, "No cutlery needed" if no_cutlery else None, legacy]

    return " · ".join(part.strip() for part in parts if part and part.strip()) or None


def rider_note(preferences: Optional[list[Any]], legacy: Optional[str] = None) -> Optional[str]:
    parts = [DELIVERY_PREFERENCES[p] for p in preferences or [] if p in DELIVERY_PREFERENCES]
    parts.append(legacy)

    return " · ".join(part.strip() for part in parts if part and part.strip()) or None
