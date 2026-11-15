# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""Migration 0052 backfills admin_seen_at on existing galleries, so an upgrade doesn't flag every
gallery with older client activity as "New". Driven through the real `alembic upgrade` (subprocess:
the migrations package shadows the Alembic library on sys.path — see test_legal_pages)."""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import sqlalchemy as sa


def test_0052_marks_existing_galleries_seen(tmp_path):
    root = Path(__file__).resolve().parents[1]
    alembic_bin = Path(sys.executable).parent / "alembic"
    db_path = tmp_path / "existing.db"
    env = {**os.environ, "DB_URL": f"sqlite:///{db_path}"}

    def upgrade(target: str) -> None:
        r = subprocess.run([str(alembic_bin), "upgrade", target], cwd=root, env=env, capture_output=True, text=True)
        assert r.returncode == 0, f"alembic upgrade {target} failed:\n{r.stderr}"

    upgrade("0051")
    engine = sa.create_engine(f"sqlite:///{db_path}")
    insp = sa.inspect(engine)
    # Fill every NOT NULL column that has no server default with a type-appropriate value.
    values: dict[str, object] = {}
    for c in insp.get_columns("galleries"):
        if c["nullable"] or c.get("default") is not None:
            continue
        t = str(c["type"]).upper()
        if c["name"] == "id":
            values["id"] = str(uuid.uuid4())
        elif "BOOL" in t or "INT" in t:
            values[c["name"]] = 0
        elif "FLOAT" in t or "REAL" in t or "NUMERIC" in t:
            values[c["name"]] = 50.0
        elif "DATE" in t:
            values[c["name"]] = "2026-01-01 00:00:00"
        else:
            values[c["name"]] = "x" + uuid.uuid4().hex[:8]
    cols = ", ".join(values)
    params = ", ".join(f":{k}" for k in values)
    with engine.begin() as conn:
        conn.execute(sa.text(f"INSERT INTO galleries ({cols}) VALUES ({params})"), values)
    engine.dispose()

    upgrade("0052")
    engine = sa.create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        seen = conn.execute(sa.text("SELECT admin_seen_at FROM galleries")).scalar_one()
    engine.dispose()
    assert seen is not None
