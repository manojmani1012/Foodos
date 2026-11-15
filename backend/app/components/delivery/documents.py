"""Rider documents: driving licence, vehicle RC and Aadhaar.

The rider photographs each one in the Delivery app; Foodos checks it in the
admin panel and approves or rejects it with a reason the rider sees. The
photos are identity papers, so they are stored private: never on the public
/media/ link, only to signed-in admins.
"""

import uuid
from typing import Any, Optional

from ...database import fetch, fetchrow, fetchval, transaction
from ...errors import bad_request, not_found
from ..media.service import delete_image, media_id_from_url, store_image

# What a rider must upload before their first delivery, in the order shown.
REQUIRED = {
    "driving_license": "Driving licence",
    "vehicle_rc": "Vehicle RC",
    "aadhaar": "Aadhaar (masked)",
}


def check_type(doc_type: str) -> str:
    if doc_type not in REQUIRED:
        raise not_found("document_type_not_found", "Foodos does not ask for that document")

    return doc_type


def as_view(rows: list[Any]) -> list[dict]:
    """Every required document, uploaded or not, in a fixed order."""
    uploaded = {row["doc_type"]: row for row in rows}
    documents = []

    for doc_type, label in REQUIRED.items():
        row = uploaded.get(doc_type)
        documents.append(
            {
                "type": doc_type,
                "label": label,
                # missing, pending (waiting for Foodos), verified or rejected.
                "status": row["status"] if row else "missing",
                "rejectionReason": row["rejection_reason"] if row else None,
                "uploadedAt": row["created_at"].isoformat() if row else None,
            }
        )

    return documents


async def list_documents(partner_id: uuid.UUID) -> list[dict]:
    rows = await fetch(
        "select doc_type, status, rejection_reason, created_at from delivery_partner_documents where partner_id = $1",
        partner_id,
    )

    return as_view(rows)


async def upload(partner_id: uuid.UUID, doc_type: str, data: bytes) -> list[dict]:
    """Saves a new photo of the document. A new photo replaces the old one and
    goes back to waiting for Foodos to check it."""
    check_type(doc_type)

    if await fetchrow("select 1 from delivery_partners where user_id = $1", partner_id) is None:
        raise bad_request("not_a_rider", "Finish signing up as a delivery partner first")

    url = await store_image(partner_id, data, private=True)

    async with transaction() as connection:
        previous = await connection.fetchval(
            "select file_url from delivery_partner_documents where partner_id = $1 and doc_type = $2 for update",
            partner_id,
            doc_type,
        )
        await connection.execute(
            """
            insert into delivery_partner_documents (partner_id, doc_type, file_url, status, created_at)
            values ($1, $2, $3, 'pending', now())
            on conflict (partner_id, doc_type) do update
              set file_url = excluded.file_url, status = 'pending', rejection_reason = null,
                  reviewed_by = null, reviewed_at = null, created_at = now()
            """,
            partner_id,
            doc_type,
            url,
        )

    if previous and previous != url:
        await delete_image(previous, partner_id)

    return await list_documents(partner_id)


async def file_of(partner_id: uuid.UUID, doc_type: str) -> Optional[Any]:
    """The photo's bytes and type, for an admin to look at."""
    check_type(doc_type)
    url = await fetchval(
        "select file_url from delivery_partner_documents where partner_id = $1 and doc_type = $2",
        partner_id,
        doc_type,
    )
    identifier = media_id_from_url(url)

    if identifier is None:
        return None

    return await fetchrow("select content_type, data from media where id = $1", identifier)
