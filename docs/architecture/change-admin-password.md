<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Change admin password

**Status:** implemented (2026-06-16)

## Goal

Let the signed-in admin change their own password from the settings UI. Today
the password is only ever set once — by the first-run setup wizard (`POST
/api/setup` → `hash_password` → `admin_password_hash`) — with no way to rotate it
afterward short of editing the DB or re-running setup.

## Current state

- Password lives in `app_settings.admin_password_hash` (bcrypt, `auth/password.py`).
- Set at setup (`routers/setup.py`), verified at login (`auth_service.login`).
- Sessions are stateless JWTs carrying a `token_version`; bumping
  `app_settings.token_version` (`settings_repo.bump_token_version`) revokes every
  outstanding token — already wired for "Sign out everywhere"
  (`POST /api/auth/logout-all`).

No schema change is needed — both columns already exist.

## Design

### Backend

**Schema** (`schemas/auth.py`):

```py
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)   # mirrors setup's min length
```

**Service** (`auth_service.change_password(db, current_password, new_password) -> str`):

1. Load settings; verify `current_password` against `admin_password_hash`. On
   mismatch raise `CodedHTTPException(400, code="invalid_current_password", …)`
   so the admin UI can localize it.
2. Reject a new password identical to the current one
   (`code="password_unchanged"`) — small nicety, avoids a no-op.
3. `settings_repo.update(db, admin_password_hash=hash_password(new_password))`.
4. **Revoke other sessions**: `bump_token_version` + `set_token_version` — a
   password change should invalidate any session on other devices (the standard
   security expectation; we already have the machinery).
5. Mint and return a fresh admin token (new `token_version`) for the current
   device so the admin isn't logged out of the very session they're acting in.

**Route** (`routers/auth.py`): `POST /api/auth/change-password`, guarded by
`get_current_admin`, rate-limited (`@limiter.limit("10/minute")`, like `login`).
It sets the reissued token back into the `access_token` cookie (httponly,
samesite=strict, `secure=cookie_secure`) so the current browser stays
authenticated. The reissued cookie is a **session cookie** (no `max_age`); a
deliberate, slightly-more-secure default — the admin can re-tick "Remember me"
on next login if they want 30 days again. (Documented trade-off, not a bug.)

### Frontend

**API client** (`lib/api.ts`):

```ts
changePassword: (current_password: string, new_password: string) =>
  request<void>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
  }),
```

**New settings page** `/admin/settings/account` (`page.tsx`) — a small form:
current password, new password, confirm new password. Client-side: new ≥ 8 chars
and `new === confirm` before enabling submit; on success a toast + clear the
fields; on `invalid_current_password` / `password_unchanged` show the mapped
localized error (via `getErrorCode`). Added to `SETTINGS_NAV`'s **Workspace**
group (admin-personal prefs) with a `KeyRound` icon, labelled "Account".

**i18n** (`messages/{en,de}.json`):
- `settings.account.*` — title, field labels, helper text, success toast.
- `settings.nav.account` — sidebar label.
- `errors.invalid_current_password`, `errors.password_unchanged`.
- Validate with `node scripts/validate-i18n.mjs`.

## Out of scope / non-goals

- Changing the admin **username** (separate concern; not requested).
- Password-strength meter / complexity rules beyond the existing 8-char minimum.
- Email-based password reset (no mail-on-by-default; this is the signed-in
  rotation path, not account recovery).
- A "keep me signed in on other devices" option — password change revokes them
  by design.

## Files touched

| File | Change |
|---|---|
| `backend/app/schemas/auth.py` | `ChangePasswordRequest` |
| `backend/app/services/auth_service.py` | `change_password` |
| `backend/app/routers/auth.py` | `POST /api/auth/change-password` (reissues cookie) |
| `frontend/src/lib/api.ts` | `api.auth.changePassword` |
| `frontend/src/app/admin/settings/account/page.tsx` | **new** — change-password form |
| `frontend/src/app/admin/layout.tsx` | add Account to `SETTINGS_NAV` |
| `frontend/messages/{en,de}.json` | `settings.account.*`, nav + error keys |

No migration. No backend dependency change.
