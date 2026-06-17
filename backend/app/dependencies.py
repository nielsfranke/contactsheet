# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from functools import lru_cache

from app.config import settings
from app.storage.local import LocalStorage


@lru_cache(maxsize=1)
def get_storage() -> LocalStorage:
    return LocalStorage(base_dir=settings.upload_dir, base_url="/uploads")
