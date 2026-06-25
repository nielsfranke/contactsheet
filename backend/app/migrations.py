# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Alembic helpers for backup/restore.

Restore needs three things: the schema revision a backup was taken at (read from
the snapshot), the running binary's known revisions (to gate forward-only
restores), and the ability to run ``alembic upgrade head`` against the restored
DB. See docs/architecture/backup-restore.md.

We deliberately do **not** import the Alembic Python API here: the migrations
package lives at ``backend/alembic/`` and shadows the installed ``alembic``
package whenever the backend dir is on ``sys.path`` (as it is under uvicorn). So
known-revision discovery scans the version files directly, and the forward
migration shells out to the ``alembic`` console script — exactly the documented
``.venv/bin/alembic upgrade head`` command, run with the backend as CWD."""

import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

from app.config import settings

# this file is backend/app/migrations.py → parent=app, parent.parent=backend
# (where alembic.ini + alembic/ live).
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_VERSIONS_DIR = _BACKEND_ROOT / "alembic" / "versions"

_REVISION_RE = re.compile(r"^revision\s*=\s*[\"']([^\"']+)[\"']", re.MULTILINE)
_DOWN_RE = re.compile(r"^down_revision\s*=\s*[\"']([^\"']+)[\"']", re.MULTILINE)


def sqlite_path(db_url: str | None = None) -> str:
    """Filesystem path behind a ``sqlite:///...`` URL. Four-slash (absolute) URLs
    keep their leading ``/`` — `sqlite:////data/x.db` → `/data/x.db`."""
    url = db_url or settings.db_url
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise ValueError(f"Not a SQLite URL: {url!r}")
    return url[len(prefix):]


def _revisions() -> tuple[set[str], set[str]]:
    """(all revision ids, all down_revision ids) found in the version scripts."""
    revs: set[str] = set()
    downs: set[str] = set()
    for path in _VERSIONS_DIR.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        m = _REVISION_RE.search(text)
        if m:
            revs.add(m.group(1))
        d = _DOWN_RE.search(text)
        if d:
            downs.add(d.group(1))
    return revs, downs


def is_known_revision(revision: str | None) -> bool:
    """True if ``revision`` is one this binary ships a migration for. History is linear,
    so a known revision is always ≤ head — a backup from a *newer* app carries an
    unknown revision, which is exactly the case we must refuse."""
    if not revision:
        return False
    revs, _ = _revisions()
    return revision in revs


def current_head() -> str | None:
    """The single head revision (the one no other migration descends from)."""
    revs, downs = _revisions()
    heads = revs - downs
    return sorted(heads)[-1] if heads else None


def revision_of_db(db_path: str) -> str | None:
    """Read ``alembic_version.version_num`` from a standalone SQLite file (the backup
    snapshot), without touching the app engine. None if the table is absent."""
    con = sqlite3.connect(db_path)
    try:
        row = con.execute("SELECT version_num FROM alembic_version").fetchone()
        return row[0] if row else None
    except sqlite3.OperationalError:
        return None
    finally:
        con.close()


def upgrade_to_head() -> None:
    """Run ``alembic upgrade head`` against the live DB (settings.db_url, via env.py).
    Shells out to the venv's ``alembic`` console script with the backend as CWD."""
    alembic_bin = Path(sys.executable).parent / "alembic"
    cmd = [str(alembic_bin) if alembic_bin.exists() else "alembic", "upgrade", "head"]
    subprocess.run(cmd, cwd=str(_BACKEND_ROOT), check=True, env=os.environ.copy())
