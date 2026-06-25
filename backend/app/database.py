# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False},  # required for SQLite + FastAPI
)


# Enable WAL mode and foreign keys for every new SQLite connection.
# busy_timeout makes a connection wait (instead of raising "database is locked") when another
# connection holds the write lock — needed now that image processing runs on a worker pool, so
# several threads may finish renditions and write their DB rows around the same time.
@event.listens_for(engine, "connect")
def _on_connect(dbapi_conn, _record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()
    # Optional: load the sqlite-vec extension when the operator opted into the vector backend.
    # Off by default → a normal deploy loads nothing here. Import is local to keep import-time cost
    # at zero when the feature is off. See app/vector_index.py.
    from app import vector_index

    if vector_index.enabled():
        vector_index.load_into(dbapi_conn)


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
