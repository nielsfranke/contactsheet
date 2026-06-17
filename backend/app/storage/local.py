# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import os
import shutil
from typing import BinaryIO

from app.storage.base import StorageProvider


class LocalStorage(StorageProvider):
    def __init__(self, base_dir: str, base_url: str = "/uploads"):
        self._base_dir = base_dir
        self._base_url = base_url.rstrip("/")

    def _full_path(self, relative_path: str) -> str:
        full = os.path.realpath(os.path.join(self._base_dir, relative_path))
        base = os.path.realpath(self._base_dir)
        if not full.startswith(base + os.sep) and full != base:
            raise ValueError("Path escapes storage root")
        return full

    def save(self, relative_path: str, data: bytes | BinaryIO) -> str:
        full = self._full_path(relative_path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        if isinstance(data, bytes):
            with open(full, "wb") as f:
                f.write(data)
        else:
            with open(full, "wb") as f:
                while chunk := data.read(1024 * 256):
                    f.write(chunk)
        return relative_path

    def get_url(self, relative_path: str) -> str:
        safe = os.path.normpath(relative_path).lstrip("/")
        return f"{self._base_url}/{safe}"

    def delete(self, relative_path: str) -> None:
        full = self._full_path(relative_path)
        try:
            os.remove(full)
        except FileNotFoundError:
            pass

    def exists(self, relative_path: str) -> bool:
        return os.path.isfile(self._full_path(relative_path))

    def move(self, src_path: str, dst_path: str) -> None:
        src = self._full_path(src_path)
        dst = self._full_path(dst_path)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)

    def copy(self, src_path: str, dst_path: str) -> None:
        src = self._full_path(src_path)
        dst = self._full_path(dst_path)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)

    def read_bytes(self, relative_path: str) -> bytes:
        with open(self._full_path(relative_path), "rb") as f:
            return f.read()
