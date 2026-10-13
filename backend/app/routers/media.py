"""Serves uploaded images.

Public on purpose: customers see dish photos before signing in, and an image
URL has to work inside a plain <Image> with no auth header.
"""

from fastapi import APIRouter
from fastapi.responses import Response

from ..components.media.service import load_image
from ..errors import not_found

router = APIRouter(tags=["media"])


@router.get("/media/{media_id}")
async def get_media(media_id: str):
    image = await load_image(media_id)

    if image is None:
        raise not_found("media_not_found", "That image does not exist")

    return Response(
        content=bytes(image["data"]),
        media_type=image["content_type"],
        # A replaced photo gets a new id, so a given URL never changes content
        # and phones can keep it for good.
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
