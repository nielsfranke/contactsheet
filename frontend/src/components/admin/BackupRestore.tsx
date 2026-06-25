// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, Download, Loader2, Upload } from "lucide-react";
import { api, getErrorCode } from "@/lib/api";
import { clearAuthenticated } from "@/lib/auth";
import type { BackupJob } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/admin/gallery-settings-fields";

const CONFIRM_WORD = "RESTORE";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Poll a backup job until it leaves the pending/running state. */
async function pollBackup(id: string): Promise<BackupJob> {
  for (;;) {
    const job = await api.adminSettings.backupGet(id);
    if (job.status === "ready" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export function BackupRestore() {
  const t = useTranslations("settings.general.backup");
  const te = useTranslations("errors");

  // --- backup ---
  const [scope, setScope] = useState<"full" | "metadata">("full");
  const [includeRenditions, setIncludeRenditions] = useState(true);
  const [building, setBuilding] = useState(false);
  const [ready, setReady] = useState<BackupJob | null>(null);

  // --- restore ---
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState(0);

  const canRestore = !restoring && !!file && confirm.trim() === CONFIRM_WORD && password.length > 0;

  async function onBackup() {
    setBuilding(true);
    setReady(null);
    try {
      const job = await api.adminSettings.backupCreate(scope, includeRenditions);
      const done = await pollBackup(job.id);
      if (done.status === "ready") {
        setReady(done);
        toast.success(t("buildSuccess"));
      } else {
        toast.error(done.error_message ?? t("buildFailed"));
      }
    } catch {
      toast.error(t("buildFailed"));
    } finally {
      setBuilding(false);
    }
  }

  function closeRestore(next: boolean) {
    if (restoring) return;
    setOpen(next);
    if (!next) {
      setFile(null);
      setConfirm("");
      setPassword("");
      setProgress(0);
    }
  }

  async function onRestore() {
    if (!canRestore || !file) return;
    setRestoring(true);
    try {
      await api.adminSettings.restore(file, password, setProgress);
      // Server rotated the runtime key from the restored settings → this cookie is dead.
      clearAuthenticated();
      toast.success(t("restoreSuccess"));
      window.location.href = "/login";
    } catch (err: unknown) {
      const code = getErrorCode(err);
      toast.error(code && te.has(code) ? te(code) : t("restoreFailed"));
      setRestoring(false);
    }
  }

  return (
    <section className="rounded-lg border border-border p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Archive size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("description")}</p>

      {/* Backup */}
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="backup-scope">{t("scopeLabel")}</Label>
          <select
            id="backup-scope"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={scope}
            onChange={(e) => setScope(e.target.value as "full" | "metadata")}
            disabled={building}
          >
            <option value="full">{t("scopeFull")}</option>
            <option value="metadata">{t("scopeMetadata")}</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {scope === "full" ? t("scopeFullHint") : t("scopeMetadataHint")}
          </p>
        </div>

        {scope === "full" && (
          <Toggle
            label={t("includeRenditions")}
            hint={t("includeRenditionsHint")}
            checked={includeRenditions}
            onChange={setIncludeRenditions}
            disabled={building}
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onBackup} disabled={building}>
            {building ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}
            {building ? t("building") : t("createButton")}
          </Button>
          {ready && (
            <a
              href={api.adminSettings.backupDownloadUrl(ready.id)}
              download
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Download size={15} />
              {t("download")}
              {ready.size_bytes != null && (
                <span className="text-muted-foreground">({formatBytes(ready.size_bytes)})</span>
              )}
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          {t("securityWarning")}
        </p>
      </div>

      {/* Restore */}
      <div className="border-t border-border pt-4 space-y-2">
        <h3 className="text-sm font-medium">{t("restoreTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("restoreDescription")}</p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Upload size={16} />
          {t("restoreButton")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={closeRestore}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("restoreDialogTitle")}</DialogTitle>
            <DialogDescription>{t("restoreDialogBody")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="restore-file">{t("fileLabel")}</Label>
              <Input
                id="restore-file"
                type="file"
                accept=".tar,.gz,.tgz,application/x-tar,application/gzip"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={restoring}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="restore-confirm">{t("confirmLabel", { word: CONFIRM_WORD })}</Label>
              <Input
                id="restore-confirm"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={CONFIRM_WORD}
                disabled={restoring}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="restore-password">{t("passwordLabel")}</Label>
              <Input
                id="restore-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={restoring}
              />
            </div>
            {restoring && progress > 0 && progress < 100 && (
              <p className="text-xs text-muted-foreground">{t("uploading", { pct: progress })}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => closeRestore(false)} disabled={restoring}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={onRestore} disabled={!canRestore}>
              {restoring ? t("restoring") : t("restoreConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
