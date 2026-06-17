// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Info } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string;
}

export function CreateSubGalleryDialog({ open, onOpenChange, parentId }: Props) {
  const t = useTranslations("admin.dialogs");
  const tc = useTranslations("common");
  const [name, setName] = useState("");
  const router = useRouter();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (navigate: boolean) => {
      const gallery = await api.galleries.create({ name: name.trim(), parent_id: parentId });
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
      <DialogContent>
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
