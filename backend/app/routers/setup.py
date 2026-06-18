# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.password import hash_password
from app.database import get_db
from app.repositories import settings_repo

router = APIRouter(prefix="/api/setup", tags=["setup"])


class SetupRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8)


@router.get("/status")
def setup_status(db: Session = Depends(get_db)):
    s = settings_repo.get(db)
    # admin_theme/accent_color are branding values, safe to expose pre-auth so the
    # login & setup screens can match the instance appearance without a flash.
    return {
        "setup_complete": s.setup_complete,
        "admin_theme": s.admin_theme,
        "accent_color": s.accent_color,
        "accent_gradient": s.accent_gradient,
        # Branding logo (served via the public /branding mount) so the login screen can show the
        # instance's own logo when one is uploaded, falling back to the fixed product mark otherwise.
        "logo_url": f"/branding/{s.logo_filename}" if s.logo_filename else None,
    }


@router.post("", status_code=201)
def complete_setup(body: SetupRequest, db: Session = Depends(get_db)):
    # Atomic claim: the conditional UPDATE both checks and sets in one statement, so two concurrent
    # setup requests can't both succeed (the loser sees the row already complete → 409).
    claimed = settings_repo.claim_setup(db, body.username, hash_password(body.password))
    if not claimed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Setup already complete")
    return {"ok": True}
