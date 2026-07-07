# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

import datetime as _dt

from sqlalchemy import DateTime, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class UTCDateTime(TypeDecorator):
    """A timezone-aware DateTime that round-trips as UTC.

    SQLite has no native datetime type — SQLAlchemy stores datetimes as naive ISO strings and reads
    them back with ``tzinfo=None`` even for ``DateTime(timezone=True)``. That meant API responses
    serialized timestamps *without* a ``Z``/offset, so browsers parsed them as **local** time (off by
    the viewer's UTC offset — e.g. "2h ago" for something that just happened in CEST). This decorator
    normalizes every value to UTC on the way in (storing naive-UTC, as SQLite does) and re-attaches
    UTC on the way out, so Pydantic always emits an explicit offset and clients parse it correctly.

    Storage format is unchanged (naive-UTC ISO string) → no migration; existing rows read back
    correctly since they were already written as UTC.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: _dt.datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(_dt.timezone.utc)
        return value.replace(tzinfo=None)

    def process_result_value(self, value: _dt.datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=_dt.timezone.utc)
        return value.astimezone(_dt.timezone.utc)

engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False},  # required for SQLite + FastAPI
    # The default QueuePool (5 + 10 overflow) exhausts during a bulk API upload — see
    # docs/architecture/db-connection-pool-under-bulk-upload.md. WAL permits unlimited concurrent
    # readers, so a larger pool absorbs the refetch storm; writes still serialize on SQLite.
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    pool_pre_ping=True,
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
