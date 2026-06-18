# Demo instance & documentation screenshots

This folder regenerates the screenshots in `docs/screenshots/` from a **reproducible** demo
instance, so a screenshot refresh is one command instead of hand-curation.

The demo is the fictional **Aperture Studio** — professional landscape / portrait / architecture
work, intentionally free of any "wedding" theming. Placeholder photos are **CC0** (sourced via
[Openverse](https://openverse.org/); see `assets/CREDITS.md`).

## Isolation

Everything runs on **ports 8099 (backend) / 3099 (frontend)** against **`demo/.data/`** (its own
SQLite DB + uploads) and a throwaway frontend copy in **`demo/.web/`** (its own `.next`). It never
reads or writes the developer's real instance on `:8000`/`:3000` or `frontend/.next`.

## Regenerate the screenshots

```bash
bash demo/run.sh            # seed + capture (uses the committed demo/assets/)
bash demo/run.sh --fetch    # also re-download & re-select the CC0 photo pool first
```

Output overwrites `docs/screenshots/*.jpg` (desktop 2880×1800, mobile 1170×2532).

## Pieces

| File | Role |
|---|---|
| `manifest.py` | Single source of truth: branding, footer, galleries → photos, modes, collaboration content, and which gallery drives each screenshot scene. |
| `fetch_assets.py` | Download a CC0 candidate pool from Openverse into `assets/_pool/` (+ review montages). |
| `select_assets.py` | Promote the hand-picked candidates into `assets/<group>/` and regenerate `assets/CREDITS.md`. |
| `seed_demo.py` | Wipe `demo/.data`, migrate, launch the demo backend, and build the instance via the REST API. Writes `demo/.data/state.json`. |
| `capture_screenshots.py` | Launch the demo backend + an isolated frontend, then drive Playwright (chromium) through the 12 scenes. |
| `run.sh` | Orchestrates seed → capture. |

## Requirements

- The backend virtualenv at `backend/.venv` (provides `uvicorn`, `alembic`, `httpx`, Pillow, and
  Playwright + chromium).
- Frontend deps installed (`frontend/node_modules`) — the demo frontend symlinks to them.
- Network access for `--fetch` only.

## Committed vs. ignored

Committed: the scripts, `assets/<group>/*.jpg`, and `assets/CREDITS.md`.
Gitignored (runtime): `demo/.data/`, `demo/.web/`, `demo/assets/_pool/`.
