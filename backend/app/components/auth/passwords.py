"""Admin password hashing.

scrypt ships with Python, so admin passwords need no third-party dependency.
Stored as "scrypt$N$r$p$salt$hash", which leaves room to raise the cost later.

The format and parameters match the previous Node implementation byte for byte,
so hashes created by either one verify under the other.
"""

import base64
import hashlib
import hmac
import os

N = 16384
R = 8
P = 1
KEY_LENGTH = 64
MAX_MEM = 256 * 1024 * 1024

# Verified against when the account does not exist, so a wrong email and a wrong
# password take the same time to answer.
DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA"


def _derive(password: str, salt: bytes, n: int, r: int, p: int, length: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=length,
        maxmem=MAX_MEM,
    )


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 8:
        raise ValueError("Password must be at least 8 characters")

    salt = os.urandom(16)
    derived = _derive(password, salt, N, R, P, KEY_LENGTH)

    return "$".join(
        [
            "scrypt",
            str(N),
            str(R),
            str(P),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(derived).decode("ascii"),
        ]
    )


def verify_password(password: str | None, stored: str | None) -> bool:
    if not isinstance(password, str) or not isinstance(stored, str):
        return False

    parts = stored.split("$")

    if len(parts) != 6 or parts[0] != "scrypt":
        return False

    _, n, r, p, salt_b64, hash_b64 = parts

    try:
        expected = base64.b64decode(salt_b64), base64.b64decode(hash_b64)
        salt, expected_hash = expected
        derived = _derive(password, salt, int(n), int(r), int(p), len(expected_hash))
    except (ValueError, TypeError, MemoryError):
        return False

    return hmac.compare_digest(derived, expected_hash)
