// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { MODE_LABELS, type ModeType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Info, MessagesSquare, Sun } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string;
  /** The parent's mode — the selector defaults to it, matching the inherited default. */
  parentMode: ModeType;
}

const MODES: { value: ModeType; descKey: string; icon: React.ReactNode }[] = [
  { value: "collaboration", descKey: "collaborationDesc", icon: <MessagesSquare size={22} /> },
  { value: "presentation", descKey: "presentationDesc", icon: <Sun size={22} /> },
];

export function CreateSubGalleryDialog({ open, onOpenChange, parentId, parentMode }: Props) {
  const t = useTranslations("admin.dialogs");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  // Defaults to the parent's mode (the inherited default). Callers remount via `key` per open,
  // so this re-seeds whenever the dialog opens for a parent.
  const [mode, setMode] = useState<ModeType>(parentMode);
  const router = useRouter();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (navigate: boolean) => {
      const gallery = await api.galleries.create({ name: name.trim(), mode, parent_id: parentId });
      return { gallery, navigate };
    },
    onSuccess: ({ gallery, navigate }) => {
      qc.invalidateQueries({ queryKey: ["galleries"] });
      toast.success(t("subGalleryCreated"));
      setName("");
      onOpenChange(false);
      if (navigate) router.push(`/admin/galleries/${gallery.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("createSubGallery")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("titlePrompt")}</p>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("titlePlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid && !create.isPending) create.mutate(true);
          }}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t("chooseMode")}</p>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-5 text-center transition-colors ${
                  mode === m.value
                    ? "border-primary ring-1 ring-primary bg-accent text-foreground"
                    : "border-border bg-card/30 text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                }`}
              >
                {m.icon}
                <span className="text-sm font-medium">{t("modeName", { mode: MODE_LABELS[m.value] })}</span>
                <span className="text-xs text-muted-foreground">{t(m.descKey)}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("changeLater")}</p>
        </div>
        <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <Info size={15} className="mt-0.5 flex-shrink-0" />
          <p>
            {t("subGalleryInherit")}
          </p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!valid || create.isPending}
              onClick={() => create.mutate(false)}
            >
              {t("create")}
            </Button>
            <Button size="sm" disabled={!valid || create.isPending} onClick={() => create.mutate(true)}>
              {t("createOpen")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
