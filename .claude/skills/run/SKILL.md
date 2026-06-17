---
description: Launch the ContactSheet backend and frontend dev servers locally
---

# Run ContactSheet locally

Paths below are relative to the repo root; run the commands from there, or substitute
your checkout's absolute path where one is required (the `.env` `DB_URL` needs an absolute path).

## Prerequisites (one-time setup)

**1. Create `backend/.env`** if it doesn't exist — the backend crashes without it. Point the
paths at this checkout's `data/` directory (use absolute paths):

```
DB_URL=sqlite:////absolute/path/to/ContactSheet/data/contactsheet.db
UPLOAD_DIR=/absolute/path/to/ContactSheet/data/uploads
EXPORTS_DIR=/absolute/path/to/ContactSheet/data/exports
BRANDING_DIR=/absolute/path/to/ContactSheet/data/branding
WATERMARKS_DIR=/absolute/path/to/ContactSheet/data/watermarks
```

**2. Create data directories** if they don't exist (from the repo root):
```bash
mkdir -p data/{uploads,exports,branding,watermarks}
```

**3. Run migrations** (required on first run or after a new migration file lands):
```bash
cd backend
alembic upgrade head        # or: .venv/bin/alembic upgrade head
```

**4. Install frontend deps** if `frontend/node_modules` is absent:
```bash
cd frontend
npm install
```

## Start both servers

```bash
# Backend — run from backend/
cd backend
uvicorn app.main:app --reload --port 8000 > /tmp/cs-backend.log 2>&1 &
# (if the repo has a virtualenv: .venv/bin/uvicorn app.main:app --reload --port 8000 ...)

# Frontend — run from frontend/
cd frontend
npm run dev > /tmp/cs-frontend.log 2>&1 &
```

Wait ~10 seconds, then verify:
```bash
curl -s http://localhost:8000/api/setup/status   # should return {"setup_complete":...}
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/  # should return 200 or 307
```

Open: `http://localhost:3000`

On a fresh database you'll be redirected to `/setup` (the first-run wizard) — that's expected.

## Notes

- If the repo has a `.venv`, use `.venv/bin/uvicorn` / `.venv/bin/alembic` (matches `CLAUDE.md`).
  Otherwise the backend runs with a system/user-level `uvicorn`; if it isn't on PATH, install it
  (e.g. `pip install uvicorn --user`).
- `uvicorn` must be launched from `backend/` (or with `--app-dir backend/`) so that `app.*` imports resolve.
- Frontend proxies `/api/*` and `/uploads/*` to `localhost:8000` via Next.js rewrites (see `next.config.ts`).
- Logs: `/tmp/cs-backend.log`, `/tmp/cs-frontend.log`
