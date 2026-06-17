// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { api, getErrorCode } from "@/lib/api";
import { clearAuthenticated } from "@/lib/auth";
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

const CONFIRM_WORD = "RESET";

export function ResetDangerZone() {
  const t = useTranslations("settings.general.danger");
  const te = useTranslations("errors");

  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && confirm.trim() === CONFIRM_WORD && password.length > 0;

  function close(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      setConfirm("");
      setPassword("");
    }
  }

  async function onReset() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.adminSettings.reset(password);
      // The secret key was rotated server-side, so this session's cookie is already dead.
      // Drop the local auth flag and hard-redirect to the setup wizard (full reload clears
      // every React Query cache and the stale cookie).
      clearAuthenticated();
      toast.success(t("success"));
      window.location.href = "/setup";
    } catch (err: unknown) {
      const code = getErrorCode(err);
      toast.error(code && te.has(code) ? te(code) : t("failed"));
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 space-y-3">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle size={16} />
        <h2 className="text-sm font-semibold">{t("title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("description")}</p>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t("button")}
      </Button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogBody")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2">
              {t("backupHint")}
            </p>
            <div className="space-y-1">
              <Label htmlFor="reset-confirm">{t("confirmLabel", { word: CONFIRM_WORD })}</Label>
              <Input
                id="reset-confirm"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={CONFIRM_WORD}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reset-password">{t("passwordLabel")}</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={onReset} disabled={!canSubmit}>
              {busy ? t("resetting") : t("confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
