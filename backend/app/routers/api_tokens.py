# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Admin management of API tokens (issue / list / revoke).

These endpoints are **cookie-admin only** (`get_current_admin`) — a token can never mint, list
or revoke other tokens. The issued secret is returned once from the create call and never again."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_admin
from app.database import get_db
from app.repositories import api_token_repo
from app.schemas.api_token import ApiTokenCreate, ApiTokenCreated, ApiTokenResponse
from app.services import api_token_service

router = APIRouter(prefix="/api/admin/api-tokens", tags=["api-tokens"])


@router.post("", response_model=ApiTokenCreated, status_code=201)
def create_token(
    body: ApiTokenCreate,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    tok, secret = api_token_service.generate(
        db, name=body.name, scopes=body.scopes, expires_at=body.expires_at
    )
    return ApiTokenCreated(**ApiTokenResponse.model_validate(tok).model_dump(), token=secret)


@router.get("", response_model=list[ApiTokenResponse])
def list_tokens(
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    return api_token_repo.list_all(db)


@router.delete("/{token_id}", status_code=204)
def revoke_token(
    token_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(get_current_admin),
):
    if not api_token_repo.delete(db, token_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")
