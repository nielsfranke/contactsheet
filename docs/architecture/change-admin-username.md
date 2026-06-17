<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Change admin username

**Status:** implemented (2026-06-16)

## Goal

Let the signed-in admin change their **login username**, alongside the password
change shipped in [change-admin-password.md](./change-admin-password.md). Like
the password, the username is set once by the setup wizard
(`POST /api/setup` → `admin_username`) with no later edit path.

## Why it's simpler than the password

The username is purely a login credential — `auth_service.login` only checks
`username != s.admin_username`. The admin **JWT does not encode the username**
(it carries `type` + `ver` only), so changing it has **no session
implications**: no `token_version` bump, no cookie reissue. The current session
and other devices keep working.

We still **require the current password** to confirm identity — same bar as the
password change. Without it, a walk-up at an unlocked screen could silently
rename the login and lock the admin out.

## Design

### Backend

**Schema** (`schemas/auth.py`):

```py
class ChangeUsernameRequest(BaseModel):
    new_username: str = Field(min_length=1, max_length=64)  # mirrors setup
    current_password: str
```

**Service** (`auth_service.change_username(new_username, current_password, db)`):

1. Verify `current_password` against `admin_password_hash` →
   `CodedHTTPException(400, code="invalid_current_password", …)` on mismatch
   (reuses the password feature's code/message).
2. `new = new_username.strip()`; reject empty after strip and reject equality
   with the current username (`code="username_unchanged"`).
3. `settings_repo.update(db, admin_username=new)`. No token bump.

**Route** (`routers/auth.py`): `POST /api/auth/change-username`, guarded by
`get_current_admin`, rate-limited `@limiter.limit("10/minute")` like login /
change-password. No cookie work.

**`GET /api/auth/me`** currently returns a **hardcoded** `{"username": "admin"}`.
Change it to return the real `admin_username` (add a `db` dependency) so the
Account page can show / prefill the current value. The only caller today
(`admin/layout.tsx`) just uses `/me` as an auth probe and ignores the body, so
this is safe.

### Frontend

**API client** (`lib/api.ts`):

```ts
changeUsername: (new_username: string, current_password: string) =>
  request<{ ok: boolean }>("/api/auth/change-username", {
    method: "POST",
    body: JSON.stringify({ new_username, current_password }),
  }),
```

**Account page** (`/admin/settings/account`) gains a **Username** section above
the existing Password section: a username field (prefilled from a
`["auth-me"]` query on `api.auth.me`) + a current-password confirm + submit.
Client-side: disable submit while empty / unchanged / saving. On success: toast
+ invalidate `["auth-me"]`. Each section keeps its own current-password confirm
— they're independent actions with different semantics (password reissues the
cookie; username doesn't).

**i18n** (`messages/{en,de}.json`): extend `settings.account.*`
(`usernameSection`, `username`, `usernameSaved`, `usernameSubmit`, reuse the
shared `current` label) and add `errors.username_unchanged`. Validate with
`node scripts/validate-i18n.mjs`.

## Out of scope / non-goals

- Username uniqueness / collision handling — single-admin app, the value is just
  the one login name.
- Character/format rules beyond length + trim (mirrors setup, which has none).
- Touching the public gallery password or share tokens (unrelated).

## Files touched

| File | Change |
|---|---|
| `backend/app/schemas/auth.py` | `ChangeUsernameRequest` |
| `backend/app/services/auth_service.py` | `change_username` |
| `backend/app/routers/auth.py` | `POST /api/auth/change-username`; `/me` returns real username |
| `frontend/src/lib/api.ts` | `api.auth.changeUsername` |
| `frontend/src/app/admin/settings/account/page.tsx` | Username section |
| `frontend/messages/{en,de}.json` | `settings.account.*` + `errors.username_unchanged` |

No migration. No backend dependency change.
