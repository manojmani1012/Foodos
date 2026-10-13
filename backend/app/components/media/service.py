"""Image storage.

Images are checked by their actual bytes, never by the filename or the
content type the client claims: a renamed file or a forged header would
otherwise get stored and then served back to every customer as an image.
"""

import uuid
from typing import Any, Optional

from ...database import execute, fetchrow
from ...errors import AppError, bad_request

# Phone cameras produce 3-8 MB originals. The apps shrink a photo before sending
# it, so anything near this limit is a mistake, not a dish photo.
MAX_IMAGE_BYTES = 5 * 1024 * 1024

MEDIA_PREFIX = "/media/"


def detect_image_type(data: bytes) -> Optional[str]:
    """Returns the image type from the file signature, or None if it is not one we accept."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"

    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"

    return None


def validate_image(data: bytes) -> str:
    if not data:
        raise bad_request("image_empty", "The photo was empty. Please choose it again")

    if len(data) > MAX_IMAGE_BYTES:
        raise AppError(413, "image_too_large", "That photo is too large. Use one under 5 MB")

    content_type = detect_image_type(data)

    if content_type is None:
        raise bad_request("image_unsupported", "Use a JPEG, PNG or WebP photo")

    return content_type


async def store_image(owner_id: Any, data: bytes) -> str:
    """Saves a validated image and returns the URL path the apps use to show it."""
    content_type = validate_image(data)

    row = await fetchrow(
        """
        insert into media (owner_id, content_type, byte_size, data)
        values ($1, $2, $3, $4)
        returning id
        """,
        owner_id,
        content_type,
        len(data),
        data,
    )

    return f"{MEDIA_PREFIX}{row['id']}"


def media_id_from_url(url: Optional[str]) -> Optional[uuid.UUID]:
    """The id inside one of our own /media/ URLs; None for anything else."""
    if not url or not url.startswith(MEDIA_PREFIX):
        return None

    try:
        return uuid.UUID(url[len(MEDIA_PREFIX):])
    except ValueError:
        return None


async def delete_image(url: Optional[str], owner_id: Any) -> None:
    """Removes a replaced image. Scoped to the owner, so a crafted URL cannot
    delete someone else's photo."""
    identifier = media_id_from_url(url)

    if identifier is None:
        return

    await execute("delete from media where id = $1 and owner_id = $2", identifier, owner_id)


async def load_image(media_id: str) -> Optional[Any]:
    try:
        identifier = uuid.UUID(media_id)
    except ValueError:
        return None

    return await fetchrow("select content_type, data from media where id = $1", identifier)
