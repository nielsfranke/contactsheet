# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt

# NOTE: bcrypt silently truncates the input to 72 bytes. Passwords longer than that share the
# same hash from byte 73 on. Acceptable for this single-admin / gallery-password model; if you
# ever need long-passphrase support, pre-hash with SHA-256 before bcrypt.


def hash_password(plaintext: str) -> str:
    return bcrypt.hashpw(plaintext.encode(), bcrypt.gensalt()).decode()


def verify_password(plaintext: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plaintext.encode(), hashed.encode())
    except Exception:
        return False
