# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt

# NOTE: bcrypt only uses the first 72 bytes of its input. bcrypt < 5 truncated silently; 5.x raises
# ValueError instead. We truncate explicitly so long passwords keep working and every hash written
# under bcrypt 4 still verifies (same 72 bytes in, same hash out). Passwords longer than that share
# the same hash from byte 73 on. Acceptable for this single-admin / gallery-password model; if you
# ever need long-passphrase support, pre-hash with SHA-256 before bcrypt.
_BCRYPT_MAX_BYTES = 72


def _encode(plaintext: str) -> bytes:
    return plaintext.encode()[:_BCRYPT_MAX_BYTES]


def hash_password(plaintext: str) -> str:
    return bcrypt.hashpw(_encode(plaintext), bcrypt.gensalt()).decode()


def verify_password(plaintext: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_encode(plaintext), hashed.encode())
    except Exception:
        return False
