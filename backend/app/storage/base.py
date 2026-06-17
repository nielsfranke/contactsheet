# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from abc import ABC, abstractmethod
from typing import BinaryIO


class StorageProvider(ABC):
    @abstractmethod
    def save(self, relative_path: str, data: bytes | BinaryIO) -> str:
        """Save data to relative_path. Returns the relative_path stored."""

    @abstractmethod
    def get_url(self, relative_path: str) -> str:
        """Return the public URL for a stored relative_path."""

    @abstractmethod
    def delete(self, relative_path: str) -> None:
        """Delete the file at relative_path. No-op if missing."""

    @abstractmethod
    def exists(self, relative_path: str) -> bool:
        """Return True if the file exists."""

    @abstractmethod
    def move(self, src_path: str, dst_path: str) -> None:
        """Move a file from src_path to dst_path within the storage root."""

    @abstractmethod
    def copy(self, src_path: str, dst_path: str) -> None:
        """Copy a file from src_path to dst_path within the storage root."""

    def read_bytes(self, relative_path: str) -> bytes:
        """Read file contents as bytes."""
        raise NotImplementedError
