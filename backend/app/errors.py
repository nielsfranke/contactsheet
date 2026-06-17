# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import HTTPException


class CodedHTTPException(HTTPException):
    """An HTTPException that also carries a stable, machine-readable ``code``.

    The backend keeps its English ``detail`` strings (dev/admin facing, by design). For the
    handful of errors clients actually see (wrong gallery password, gallery expired, upload too
    large / wrong type, client upload disabled), we attach a ``code`` so the frontend can render a
    localized message — falling back to the raw ``detail`` for unknown codes. Serialized to the
    response body as ``{"detail": ..., "code": ...}`` by the handler in ``app.main``.
    """

    def __init__(self, status_code: int, code: str, detail: str, headers: dict | None = None):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code
