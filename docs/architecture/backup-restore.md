<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Backup & restore

**Status:** implemented (2026-06-25) on branch `feature/backup-restore`.

> Implementation notes vs. this design: the endpoints live under the existing
> admin-settings router (`/api/admin/settings/backup…`, `/api/admin/settings/restore`)
> alongside factory reset, not a new `/api/admin/backup` prefix; the CLI entry point
> is `python -m app.restore <archive>`. Encryption and scheduled backups remain
> deferred (see Decisions). Migration `0040` adds `backup_jobs`.

## Goal

Give a self-hosted operator a **first-class, in-app way to capture the entire
instance and bring it back** — every gallery, photo, comment, vote, collection
and setting — to a single portable archive, and to restore that archive onto a
fresh (or existing) deployment.

Today the only documented recovery path is the *opposite* of recovery:
[factory reset](../docs/architecture/factory-reset.md) wipes everything, and the
"backup before reset" step was explicitly punted ("the user owns their data
dir; a separate feature if wanted"). This is that feature. The whole app is a
SQLite file plus a few media directories — losing `/data` loses every client
gallery with no in-app way back. Backup/restore closes that gap and doubles as
the **migration** tool (move an instance to a new host) and the **safety net**
before risky upgrades.

## What a backup must contain

The instance state lives in two stores (see `config.py`):

| Store | Path (default) | In backup? | Why |
|---|---|---|---|
| SQLite DB | `db_url` → `/data/contactsheet.db` | **always** | the source of truth — galleries, images, feedback, settings, admin creds, secret key |
| Uploads | `upload_dir` → `/data/uploads` | scope-dependent | originals **and** derived renditions (thumb/medium) + cached `{variant}-wm/` watermarks |
| Branding | `branding_dir` → `/data/branding` | **always** | logos/favicons referenced by `app_settings` + PWA icons |
| Watermarks | `watermarks_dir` → `/data/watermarks` | **always** | source watermark images referenced by settings |
| Exports | `exports_dir` → `/data/exports` | **never** | regenerable, TTL'd ZIP-job output (`zip_ttl_hours`) — pure cache |

`exports_dir` is excluded unconditionally — it's transient ZIP-job scratch that
the app rebuilds on demand. Everything else is either the source of truth or
small-and-referenced.

### Two backup scopes (operator choice)

1. **Full** — DB + `uploads` + `branding` + `watermarks`. Complete disaster
   recovery; can be large (the originals dominate).
2. **Metadata-only** — DB + `branding` + `watermarks`, **excluding `uploads`**.
   Small and fast. For the common photographer who already backs their originals
   up elsewhere (NAS, cloud), or who wants to snapshot just settings + gallery
   structure + client feedback. On restore, originals are expected to be
   reattached out-of-band; images whose files are missing degrade gracefully
   (renditions absent), they aren't deleted.

Within Full, a sub-option **exclude regenerable renditions** (ship originals
only, drop thumb/medium/`*-wm`) trades a smaller archive for a rebuild step on
restore. Default: include renditions (restore is instant, no reprocessing).

## Consistency model (the hard part)

The DB is **SQLite in WAL mode with `foreign_keys=ON`** (`database.py`). Two
consequences:

- **Never tar the live `.db` file.** With WAL, the committed state is split
  across `contactsheet.db` + `-wal` + `-shm`; a naive copy can capture a torn
  state. The backup snapshots the DB via **`VACUUM INTO '<snapshot>'`** (or the
  SQLite Online Backup API) → a single, internally-consistent, checkpointed file
  with no sidecars. This runs against the app's own engine so it cooperates with
  in-flight writers.
- **DB and files aren't captured atomically**, so order them to fail safe.
  The upload path writes the file to disk **before** committing the row, so:
  copy **files first, snapshot the DB last** → every row in the snapshot
  references a file that already existed when the files were copied. The only
  possible skew is an *orphan file* (written mid-upload, row not yet committed) —
  harmless on restore (unreferenced bytes), and reaped by normal cleanup.

This gives a **crash-consistent** backup without quiescing the app or taking a
global write lock.

## Archive format

A single **`.tar`** (streamed; gzip optional and off by default — photos are
already compressed, so gzip mostly burns CPU like the ZIP-STORED decision in
`docs/architecture/streaming-zip-downloads.md`). Layout:

```
contactsheet-backup-<instance>-<UTC-timestamp>.tar
├── manifest.json
├── db.sqlite3              # VACUUM INTO snapshot (no -wal/-shm)
├── uploads/    …           # (omitted in metadata-only scope)
├── branding/   …
└── watermarks/ …
```

`manifest.json` carries everything restore needs to validate compatibility:

```jsonc
{
  "format_version": 1,            // bump on incompatible archive layout changes
  "app_version": "1.2.3",         // from the running build
  "alembic_revision": "0039",     // DB schema head at backup time — the gate
  "scope": "full" | "metadata",   // what was captured
  "includes_renditions": true,
  "created_at": "2026-06-25T...Z",
  "db_sha256": "...",             // integrity of the snapshot
  "counts": { "galleries": N, "images": N }   // sanity display in the restore UI
}
```

### Schema compatibility on restore (the safety gate)

`alembic_revision` is the linchpin. On restore, compare the archive's revision
to the running binary's migration head:

- **older** → accept: swap the DB, then run `alembic upgrade head` to migrate the
  restored DB forward to the current schema. (This is also what makes
  restore-after-upgrade work.)
- **equal** → accept directly.
- **newer** → **refuse** with a clear error: the archive came from a newer
  ContactSheet than this binary; downgrade isn't supported. Upgrade the app
  first, then restore.

`format_version` guards the archive *layout* itself (separate from DB schema) so
a future restructuring of the tar can be rejected cleanly by old binaries.

## Guardrails

Restore is **at least as destructive as factory reset** — it replaces the entire
instance — so it inherits the same guardrails-first posture:

- **Admin-only** endpoints (`get_current_admin`), **rate-limited** (mirror reset's
  strict `3/minute`).
- **Restore requires password re-entry + typed confirmation** (`RESTORE`), like
  the reset dialog. Copy spells out that it **overwrites all current data**.
- Restore brings back the archive's **secret key + `token_version`** (they live
  in `app_settings`), so the acting admin's cookie is invalidated → forced
  re-login. Expected and correct, same as reset's key rotation.
- **Backups are sensitive**: they contain client photos, the admin password hash,
  and the JWT secret key. The UI must label the download as such. **Optional
  passphrase encryption** (age / AES-256-GCM over the tar) is a strong follow-up;
  MVP ships unencrypted with an explicit warning, since the operator controls
  where the file lands.

## Design

### Backup (mirror the async ZIP-job pattern)

Full backups can be many GB, so reuse the proven job model from
`zip_export.py` / `tasks/zip_task.py` rather than building in a request:

- **`POST /api/admin/backup`** `{scope, include_renditions}` → creates a
  `BackupJob` row, kicks a `BackgroundTasks` builder, returns the job id.
- **`tasks/backup_task.py`** — `build_backup(job)`:
  1. `VACUUM INTO` the DB to a temp path inside `exports_dir`.
  2. Stream a tar to `exports_dir`: manifest → db snapshot → walk the in-scope
     media dirs (skip `exports_dir` always; skip rendition/`*-wm` dirs when
     `include_renditions=false`). Files are read off disk and appended; never
     buffered whole in memory.
  3. Update `BackupJob` status (`pending → running → ready|error`), record size +
     sha256, set a TTL like ZIP jobs.
- **`GET /api/admin/backup/{id}`** poll; **`GET /api/admin/backup/{id}/download`**
  stream the tar with an exact `Content-Length` (sized, no recompression) so the
  browser shows real progress — same trick as the streaming ZIP.

A new `BackupJob` model + migration (`0040`) — reuse the `ZipJob` shape
(status/error/size/expires_at). Could even generalize `ZipJob`, but a sibling
table keeps the cleanup/TTL logic independent and avoids churning the ZIP path.

### Restore (two entry points — size dictates which)

Restore is the awkward direction: a multi-GB upload through nginx + FastAPI is
fragile. Offer both:

1. **Web upload** (typical instances) — `POST /api/admin/restore` (multipart,
   the archive + `{password, confirm}`). Streams the upload to a temp file
   (bounded; nginx `client_max_body_size` must allow it — a deploy note, cf. the
   host-mounted nginx caveat in memory). Then runs the restore service.
2. **CLI / file-drop** (large or headless instances) — a
   `python -m app.restore <archive>` management command (and/or a documented
   "drop the tar in `/data/restore/` and restart" hook). Avoids pushing tens of
   GB back through the HTTP stack. This is the recommended path for big studios.

- **`app/services/restore_service.py`** — `restore(db, archive, password)`:
  1. Verify password against the **current** `admin_password_hash` *before*
     touching anything (you must be the current admin to restore over it). If the
     instance is fresh (no admin yet, e.g. brand-new host migration), allow
     restore during the setup window with a one-time guard.
  2. Open + validate `manifest.json`: `format_version` known, `db_sha256`
     matches, `alembic_revision` not newer than head (else refuse).
  3. `engine.dispose()` so no pooled connection holds the old DB file across the
     swap. (The restore route deliberately takes no DB session — `get_current_admin`
     is DB-free — so nothing is checked out during the swap.)
  4. **Two-phase swap** (`_swap_in`):
     - **Phase 1 — DB (reversible).** Copy the live DB to `contactsheet.db.bak`,
       replace `contactsheet.db` with the snapshot (delete stale `-wal`/`-shm`),
       `alembic upgrade head`, then reload `runtime_config` (new secret key +
       token_version → all old sessions invalid). If anything here fails, roll the
       DB back from `.bak` and **leave media untouched** → the instance is exactly
       as before.
     - **Phase 2 — media (point of no return).** Only after the DB is committed,
       replace each in-scope media dir's **contents** in place (clear + move;
       keeps the static-mount root inode valid, same constraint factory-reset
       respects). Media can't be rolled back transactionally, so it runs *last*:
       a mid-media failure leaves the restored DB beside partially-swapped media,
       which a re-run (CLI) completes — strictly better than a half-migrated DB.
  5. Return `{ok, restored_counts}`. Client clears the auth flag and
     hard-redirects to `/login` (or `/setup` if the restored DB itself predates
     setup, though a real backup never will).

> The original design floated a maintenance lock + atomic per-store rename; the
> shipped version is simpler (DB-phase rollback + media-last) and leans on the
> "restore onto a fresh/quiet instance" guidance below rather than a hard lock.

## Deploy / upgrade impact

Two things that an image pull alone does **not** deliver — call them out in release notes:

- **`nginx.conf` is host-mounted.** The bundled `nginx.conf` gains a
  `location ~ ^/api/admin/settings/(backup|restore)` block raising
  `client_max_body_size` to `2g` + 30-min timeouts (the restore upload carries a
  whole archive; the download streams one back). Without it both routes fall
  through to `location /api/` and inherit the 1 MB cap + 120s timeout, 413-ing or
  truncating any real backup. Operators must update their host-mounted nginx.conf
  (or, for a custom/edge proxy, raise the equivalent limit themselves).
- **Migration `0040`** (`backup_jobs`) must be applied on upgrade
  (`alembic upgrade head`), like any schema change.

### Frontend

- **API** — `api.adminSettings.backup.create/get/download` + `.restore(file,
  password)`.
- **UI** — a **"Backup & restore"** card on `/admin/settings/general`, *above*
  the existing red "Danger zone" reset card. Backup side: scope radio (Full /
  Metadata-only) + "include renditions" checkbox, a "Create backup" button that
  shows job progress then a download link. Restore side: a file picker + password
  + typed `RESTORE` confirm + destructive button, reusing the reset dialog's
  guard pattern. Show the archive's `manifest` (app version, date, counts) after
  the file is selected so the operator confirms *what* they're about to restore.
- **i18n** — `settings.general.backup.*` in en + de; validate with
  `node scripts/validate-i18n.mjs`.

## Out of scope / non-goals (for MVP)

- **Scheduled / automatic backups + retention** — high-value follow-up. Once the
  CLI builder exists, an operator can cron it; an in-app scheduler + rotation
  (keep last N / daily-weekly-monthly) is a phase 2. Note: there is no Celery —
  it would ride the same in-process loop pattern as the notification flusher.
- **Off-site / S3 upload targets** — the archive is local; pushing it to object
  storage is a later add-on (reuse the notification channel-secret masking idea
  for credentials).
- **Incremental / dedup backups** — every backup is a full snapshot. Fine at
  self-hosted scale; revisit only if archive size becomes painful.
- **Per-gallery export/import** (move one gallery between instances) — different
  feature; this is whole-instance.
- **Encryption** — strongly recommended but MVP ships plaintext + a warning (see
  Guardrails).

## Decisions (resolved 2026-06-25)

1. **Restore over a live instance vs. maintenance mode** → **support both; bless
   "restore onto a fresh instance" as the documented happy path.** Build the
   in-process live swap (maintenance flag → WAL checkpoint → extract-then-rename
   per dir → keep `contactsheet.db.bak` for rollback) behind the strong confirm,
   but the docs steer clean migrations toward an empty deploy (nothing to
   half-overwrite).
2. **Generalize `ZipJob` or add `BackupJob`** → **separate `BackupJob` table.**
   They share a shape but their TTL/cleanup lifecycles diverge — ZIP jobs reap
   on the aggressive `zip_ttl_hours` (24h) clock; a backup must not. The ~5
   duplicated columns are cheaper than coupling the two lifecycles.
3. **gzip the tar** → **branch on scope: `tar` for Full, `tar.gz` for
   metadata-only.** Full is already-compressed JPEGs (gzip = wasted CPU, per the
   ZIP-STORED reasoning); metadata-only is mostly SQLite/text and compresses well.
4. **Encryption** → **fast-follow, not MVP.** MVP ships a plaintext tar with a
   loud UI warning that it contains client photos, the admin password hash, and
   the JWT `secret_key` — "store this file securely." Passphrase encryption
   (age / AES-256-GCM, with "lost passphrase = unrecoverable" copy) is the next
   iteration. The operator controls where the file lands, so this is acceptable
   to ship first.
5. **Scheduled backups + retention** → **deferred to phase 2** (already a non-goal
   above). MVP is on-demand (button + CLI); operators cron the CLI until the
   in-app scheduler + rotation lands on the notification-flusher loop pattern.

## Files touched (estimate)

| File | Change |
|---|---|
| `backend/app/models/backup_job.py` | **new** — `BackupJob` (status/size/sha/expires) |
| `backend/alembic/versions/0040_*.py` | **new** — `backup_jobs` table |
| `backend/app/services/backup_service.py` | **new** — orchestrate create/list |
| `backend/app/tasks/backup_task.py` | **new** — `build_backup` (VACUUM INTO + stream tar) |
| `backend/app/services/restore_service.py` | **new** — validate + swap + `alembic upgrade` |
| `backend/app/routers/admin_settings.py` | `POST /api/admin/backup`, `GET …/{id}`, `…/download`, `POST /api/admin/restore` |
| `backend/app/restore.py` (or `app/cli.py`) | **new** — CLI restore entry point |
| `backend/app/schemas/...` | `BackupRequest`, `BackupJobOut`, `RestoreRequest` |
| `frontend/src/lib/api.ts` | `api.adminSettings.backup.*` + `.restore` |
| `frontend/src/app/admin/settings/general/page.tsx` | Backup & restore card |
| `frontend/messages/{en,de}.json` | `settings.general.backup.*` |
| `nginx.conf` (host-mounted) | raise `client_max_body_size` for web restore — **deploy note** |
| `docs/architecture/backup-restore.md` | promote this proposal once approved |

No change to the upload/serve hot paths. One migration. No new hard dependency
(tar + SQLite `VACUUM INTO` are stdlib; encryption, if added, brings `pyca`/age).
