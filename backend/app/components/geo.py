"""Distances and map pins, shared by browsing, ordering, dispatch and tracking.

Distances are straight lines. Roads are longer, so ride times multiply by a
road factor; real road routing needs a routing service and is a later change.
"""

import math
from typing import Any, Optional

# Roughly India, so a swapped latitude and longitude, or a pin dropped in the
# sea off Africa, is caught before riders are sent there.
INDIA_LATITUDE = (6.0, 37.5)
INDIA_LONGITUDE = (68.0, 97.5)

# City riding: about 20 km/h door to door, on roads about 1.4 times longer
# than the straight line.
ROAD_FACTOR = 1.4
RIDE_KMPH = 20


def distance_km(a_lat: Any, a_lng: Any, b_lat: Any, b_lng: Any) -> Optional[float]:
    """Straight-line distance between two points, or None if either is unknown."""
    if None in (a_lat, a_lng, b_lat, b_lng):
        return None

    lat1, lng1, lat2, lng2 = map(math.radians, map(float, (a_lat, a_lng, b_lat, b_lng)))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2

    return round(2 * 6371 * math.asin(math.sqrt(h)), 2)


def ride_minutes(km: Optional[float]) -> int:
    """Minutes to ride a straight-line distance through the city."""
    if not km:
        return 0

    return math.ceil(km * ROAD_FACTOR / RIDE_KMPH * 60)


def in_india(latitude: Optional[float], longitude: Optional[float]) -> bool:
    if latitude is None or longitude is None:
        return False

    return (
        INDIA_LATITUDE[0] <= latitude <= INDIA_LATITUDE[1]
        and INDIA_LONGITUDE[0] <= longitude <= INDIA_LONGITUDE[1]
    )


def sql_distance_km(lat_column: str, lng_column: str, lat_param: str, lng_param: str) -> str:
    """The same straight-line distance, as SQL, for filtering and sorting rows."""
    # least(1, ...): floating-point error can push the root a hair over 1,
    # which asin rejects.
    return (
        f"(2 * 6371 * asin(least(1, sqrt("
        f"power(sin(radians({lat_column}::float8 - {lat_param}::float8) / 2), 2)"
        f" + cos(radians({lat_param}::float8)) * cos(radians({lat_column}::float8))"
        f" * power(sin(radians({lng_column}::float8 - {lng_param}::float8) / 2), 2)))))"
    )
