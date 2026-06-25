# SPDX-FileCopyrightText: 2026 Niels Franke
# SPDX-License-Identifier: AGPL-3.0-or-later

"""CLI restore entry point: ``python -m app.restore <archive>``.

The blessed path for large instances — restoring tens of GB over HTTP is fragile,
so an operator with filesystem access runs this directly (no password needed; you
already own the host). Stop the running container first for a clean swap. See
docs/architecture/backup-restore.md."""

import argparse
import logging
import os
import sys

from app.services import restore_service


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="python -m app.restore", description="Restore ContactSheet from a backup archive")
    parser.add_argument("archive", help="Path to a ContactSheet backup .tar / .tar.gz")
    parser.add_argument("--yes", action="store_true", help="Skip the interactive confirmation")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.archive):
        print(f"error: no such file: {args.archive}", file=sys.stderr)
        return 2

    if not args.yes:
        print("This OVERWRITES the current instance (database + media). The app should be stopped.")
        if input("Type RESTORE to continue: ").strip() != "RESTORE":
            print("Aborted.")
            return 1

    try:
        result = restore_service.restore(args.archive, password=None, verify_admin=False)
    except Exception as exc:  # surface a clean message, not a traceback
        print(f"Restore failed: {exc}", file=sys.stderr)
        return 1

    counts = result.get("restored", {})
    print(f"Restore complete. Galleries: {counts.get('galleries', '?')}, images: {counts.get('images', '?')}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
