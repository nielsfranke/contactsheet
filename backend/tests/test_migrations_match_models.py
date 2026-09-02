# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""The unit suite builds its schema with `Base.metadata.create_all`, so a model column added
without a migration passes every other test and only fails on a real `alembic upgrade head`
(CI's E2E job, or the live instance). This test runs the real migrations on a scratch DB and
diffs the result against the models."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, inspect

from app.database import Base

_BACKEND = Path(__file__).resolve().parent.parent


def _upgrade(db_path: str) -> None:
    alembic = Path(sys.executable).parent / "alembic"
    env = {**os.environ, "DB_URL": f"sqlite:///{db_path}"}
    subprocess.run([str(alembic), "upgrade", "head"], cwd=_BACKEND, env=env, check=True,
                   capture_output=True, text=True)


def test_alembic_head_matches_the_models():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "migrated.db")
        _upgrade(path)
        insp = inspect(create_engine(f"sqlite:///{path}"))
        migrated = {
            t: {c["name"]: bool(c["nullable"]) for c in insp.get_columns(t)}
            for t in insp.get_table_names() if t != "alembic_version"
        }

    modelled = {
        t.name: {c.name: bool(c.nullable) for c in t.columns}
        for t in Base.metadata.sorted_tables
    }

    assert set(migrated) == set(modelled), (
        f"tables only in migrations: {set(migrated) - set(modelled)}; "
        f"only in models: {set(modelled) - set(migrated)}"
    )
    drift = {
        t: {
            "only_in_migrations": sorted(set(migrated[t]) - set(modelled[t])),
            "only_in_models": sorted(set(modelled[t]) - set(migrated[t])),
            "nullability": sorted(
                c for c in set(migrated[t]) & set(modelled[t]) if migrated[t][c] != modelled[t][c]
            ),
        }
        for t in modelled
    }
    drift = {t: d for t, d in drift.items() if any(d.values())}
    assert not drift, f"schema drift between alembic head and the models: {drift}"
