<!--
SPDX-FileCopyrightText: 2026 Niels Franke
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Backup & restore (operator guide)

How to back up a ContactSheet instance and restore it. This is the practical
how-to; for the internal design see
[`docs/architecture/backup-restore.md`](architecture/backup-restore.md).

> **One-line summary:** a backup is a single downloadable file containing your
> whole instance. Download it and keep it somewhere safe — **the server does not
> keep your backups for you.** With that file you can rebuild the instance from
> scratch, even after a factory reset or on a brand-new server.

## What's in a backup

A backup is one archive (`contactsheet-backup-<date>-<id>.tar` / `.tar.gz`)
containing:

- the **database** — every gallery, photo record, comment, vote, rating,
  collection, and **all instance settings**;
- your **media** — uploaded originals and generated previews (Full backups);
- **branding** assets and **watermark** images.

It does **not** include the regenerable ZIP-export scratch folder.

### ⚠️ A backup contains your credentials and security keys

The database — and therefore every backup — includes your **admin username and
password hash**, the instance **secret key**, and notification channel
credentials. Treat a backup file like a password:

- Anyone who has it can stand up a working copy of your instance.
- Store it somewhere private (encrypted disk, password manager vault, etc.).
- Backups are currently **not encrypted** (see [Limitations](#limitations)).

## Two scopes

| Scope | Contains | Use when |
|---|---|---|
| **Full** | Database + photos + branding + watermarks | Complete disaster recovery / moving hosts. Can be large. |
| **Settings & metadata only** | Database + branding + watermarks (**no photos**) | Your photos are backed up elsewhere (NAS/cloud) and you only need settings, gallery structure and client feedback. Small and fast. |

Within **Full**, *Include generated previews* can be turned off for a smaller
file — thumbnails/previews are dropped and regenerated after a restore.

## Create a backup

1. Go to **Settings → General → Backup & restore**.
2. Choose **What to include** (and the previews toggle for Full).
3. Click **Create backup**. When it finishes, a **Download backup** link appears.
4. **Click Download and save the file off the server** — to your laptop, a NAS,
   cloud storage, wherever you keep important files.

> **The server only keeps a backup temporarily.** Server-side copies are pruned
> automatically (the next time you create a backup, anything older than ~24h is
> removed) and are erased entirely by a factory reset. The copy you download is
> the one that lasts. Download every backup you care about.

CLI / scripted backups aren't built in yet; you can snapshot the `/data`
directory at the filesystem level as a stopgap (see Limitations).

## Restore a backup

Restoring **replaces the entire instance** with the archive's contents and signs
you out. Two ways:

### A) From the web UI (typical)

1. Go to **Settings → General → Backup & restore → Restore from backup…**.
2. Select your downloaded archive.
3. Type `RESTORE` and enter **your current admin password**.
4. Click **Restore**. When it completes you're redirected to the login page —
   sign in again (see the note on credentials below).

Large archives upload through the web server. The bundled nginx allows backup
uploads/downloads up to **2 GB**; beyond that (or if you run a custom/edge proxy
with a smaller limit), use the CLI path. If you upgraded an existing instance,
make sure your **host-mounted `nginx.conf`** includes the backup/restore
`location` block — an image pull alone won't add it.

### B) From the command line (large instances / fresh hosts)

The blessed path when restoring tens of GB or onto an empty server. Stop the app
first for a clean swap, then run the restore against the archive:

```bash
# Docker deployment — place the archive on the shared /data volume first:
docker compose exec backend python -m app.restore /data/contactsheet-backup-….tar

# Local/dev:
cd backend && .venv/bin/python -m app.restore /path/to/contactsheet-backup-….tar
```

The CLI doesn't ask for a password (you already have host access) and works even
on a fresh instance with no admin set up yet.

## Your questions, answered

### Can I restore after a factory reset?

**Yes — *if you downloaded the backup first*.**

A [factory reset](architecture/factory-reset.md) wipes everything on the server,
**including any server-side backup files** (they live under the data directory
that reset clears) and the record of them. It does **not** reach the file you
already downloaded to your own machine.

So the safe sequence is:

1. Create a backup **and download it** to your computer.
2. Factory-reset if you need to.
3. Restore from the downloaded file:
   - **CLI:** run `python -m app.restore <archive>` straight away — it works on
     the fresh post-reset instance with no admin.
   - **Web UI:** the reset leaves you at the setup wizard, so first create a
     *temporary* admin and log in, then go to **Restore from backup…** and enter
     that temporary password to authorize the restore. (The restore then brings
     back your original account — see below — so the temporary one is replaced.)

If you reset **without** having downloaded the backup, it's gone. There's no
server-side undo. **Always download before you reset.**

### What about my username and password — are they independent of backup/restore?

**No — they are part of the backup.** Your admin username and password live in
the database (in instance settings), so:

- A backup **captures** your username + password hash (and the instance secret
  key) at the moment it's taken.
- A restore **brings them back**. After restoring, your login is whatever it was
  **when the backup was created**, not what it is now.

Concretely:

- If you changed your password *after* taking a backup and then restore that
  backup, your password reverts to the **older** one from the backup.
- Restoring on a fresh instance (or after a reset) replaces the temporary admin
  you set up with the **original** account from the backup.
- Because the secret key is also restored, **every active session is invalidated**
  by a restore — you'll always have to log in again afterwards, using the
  backup-time credentials.

This is also why the backup file is sensitive: it carries those credentials.

## Version compatibility

A backup records the ContactSheet version and database schema it was made with.

- Restoring a backup from an **older** version is fine — the database is migrated
  forward automatically during the restore.
- Restoring a backup from a **newer** version than the running instance is
  **refused**. Upgrade ContactSheet first, then restore.

## Limitations

- **Not encrypted.** Archives are plain (they contain the password hash + secret
  key). Encryption is a planned addition; for now, protect the file yourself.
- **No scheduled/automatic backups yet.** Creating a backup is a manual action.
  As a stopgap you can snapshot the host `/data` directory on a schedule (stop
  the app or accept crash-consistency).
- **One full snapshot per backup** — no incremental/differential backups.
- **Whole-instance only** — there is no per-gallery export/import here.

## See also

- [Factory reset](architecture/factory-reset.md)
- [Backup & restore — architecture/design](architecture/backup-restore.md)
