# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later
"""bcrypt 5 raises on inputs over 72 bytes (4.x truncated silently). ``app.auth.password`` truncates
explicitly, so long passwords must keep hashing and hashes written under bcrypt 4 must keep verifying."""

import bcrypt

from app.auth.password import hash_password, verify_password


def test_long_password_hashes_and_verifies():
    long_pw = "correct horse battery staple " * 5  # ~145 bytes
    hashed = hash_password(long_pw)
    assert verify_password(long_pw, hashed)
    assert not verify_password("something else", hashed)


def test_multibyte_password_over_limit():
    pw = "ü" * 50  # 100 bytes in UTF-8
    assert verify_password(pw, hash_password(pw))


def test_legacy_bcrypt4_hash_of_long_password_still_verifies():
    # bcrypt 4 hashed only the first 72 bytes; reproduce such a stored hash directly.
    long_pw = "x" * 100
    legacy = bcrypt.hashpw(long_pw.encode()[:72], bcrypt.gensalt()).decode()
    assert verify_password(long_pw, legacy)


def test_short_password_roundtrip():
    hashed = hash_password("hunter2")
    assert verify_password("hunter2", hashed)
    assert not verify_password("hunter3", hashed)
    assert not verify_password("hunter2", "not-a-hash")
