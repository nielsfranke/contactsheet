// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Themed confirmation dialog — the replacement for native `window.confirm()`. Controlled: the parent
 * owns `open` and supplies `onConfirm`, matching every other dialog in the app. Renders in the
 * `Dialog` portal (under the gallery scope on public pages), so it's themed everywhere.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Confirm button text. Defaults to a generic "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible actions. */
  destructive?: boolean;
  /** Disables buttons while the action runs. */
  pending?: boolean;
  onConfirm: () => void;
}) {
  const tc = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel ?? tc("cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => onConfirm()}
          >
            {confirmLabel ?? tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
