# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Runtime values resolved during app startup (not available from static config)."""

_secret_key: str | None = None
_token_version: int = 1


def get_secret_key() -> str:
    if _secret_key is None:
        raise RuntimeError("Secret key not initialised — startup incomplete")
    return _secret_key


def set_secret_key(key: str) -> None:
    global _secret_key
    _secret_key = key


def get_token_version() -> int:
    """Current admin-session generation. Bumped to revoke all outstanding admin tokens."""
    return _token_version


def set_token_version(version: int) -> None:
    global _token_version
    _token_version = version
