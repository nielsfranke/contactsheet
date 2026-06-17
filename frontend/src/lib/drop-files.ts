// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Minimal slice of the File and Directory Entries API. Lib.dom ships these as
// `FileSystemEntry`/`FileSystemDirectoryEntry`/`FileSystemFileEntry`, but
// `DataTransferItem.webkitGetAsEntry()` is typed loosely, so we narrow here.
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
}
interface FsFileEntry extends FsEntry {
  file(onSuccess: (f: File) => void, onError?: (e: unknown) => void): void;
}
interface FsDirectoryEntry extends FsEntry {
  createReader(): {
    readEntries(onSuccess: (entries: FsEntry[]) => void, onError?: (e: unknown) => void): void;
  };
}

function entryToFile(entry: FsFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// A directory reader returns its children in batches of (typically) ≤100, so we
// must keep calling readEntries() until it yields an empty array.
function readAllEntries(dir: FsDirectoryEntry): Promise<FsEntry[]> {
  const reader = dir.createReader();
  const all: FsEntry[] = [];
  return new Promise((resolve, reject) => {
    const pump = () =>
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        pump();
      }, reject);
    pump();
  });
}

// Recursively collect files. Files inside a directory are kept only if `accept`
// passes (silently dropping `.DS_Store`, sidecar XMP, RAW, etc.). The top-level
// `keepUnaccepted` lets directly-dropped files through so the caller can still
// surface a "wrong type" toast for an explicit choice.
async function walk(entry: FsEntry, accept: (f: File) => boolean, keepUnaccepted: boolean): Promise<File[]> {
  if (entry.isFile) {
    const file = await entryToFile(entry as FsFileEntry);
    return keepUnaccepted || accept(file) ? [file] : [];
  }
  if (entry.isDirectory) {
    const children = await readAllEntries(entry as FsDirectoryEntry);
    const nested = await Promise.all(children.map((c) => walk(c, accept, false)));
    return nested.flat();
  }
  return [];
}

/**
 * Flatten a drop's `DataTransfer` into a list of files, descending into any
 * dropped folders (no folder structure is preserved). Files nested inside a
 * folder are filtered to `accept`; files dropped directly are returned as-is so
 * the caller's own validation can report unsupported types.
 *
 * Falls back to `dataTransfer.files` when the Entries API is unavailable so
 * older browsers keep their current flat-file behaviour.
 */
export async function collectDroppedFiles(
  dt: DataTransfer,
  accept: (f: File) => boolean
): Promise<File[]> {
  const items = dt.items;
  // Snapshot the entries *synchronously* — the items list is invalidated once
  // this handler returns / after the first await.
  const entries: FsEntry[] = [];
  if (items && typeof items[0]?.webkitGetAsEntry === "function") {
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry() as FsEntry | null;
      if (entry) entries.push(entry);
    }
  }

  if (!entries.length) return Array.from(dt.files);

  const collected = await Promise.all(entries.map((e) => walk(e, accept, true)));
  return collected.flat();
}
