// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { GalleryResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputClearButton } from "@/components/chrome/InputClearButton";
import { cn } from "@/lib/utils";
import { Copy, FolderInput, FolderPlus, Layers, CornerDownRight } from "lucide-react";
import { toast } from "sonner";

type Destination = "new" | "existing";
type Operation = "copy" | "move";
type Placement = "sub" | "top";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceGalleryId: string;
  sourceGalleryName: string;
  /** Depth-flattened gallery tree for the "existing gallery" picker. */
  moveTargets: { g: GalleryResponse; depth: number }[];
  imageIds: string[];
  defaultName: string;
  /** Set when the images came from a collection — on a Move, the now-empty collection is removed. */
  collectionId: string | null;
}

/** A small two-or-three option segmented control matching the create-gallery mode cards. */
function Seg<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
            value === o.value
              ? "border-primary ring-1 ring-primary bg-accent text-foreground"
              : "border-border bg-card/30 text-muted-foreground hover:border-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function CreateGalleryFromImagesDialog({
  open, onOpenChange, sourceGalleryId, sourceGalleryName, moveTargets, imageIds, defaultName, collectionId,
}: Props) {
  const t = useTranslations("admin.detail.fromImages");
  const tc = useTranslations("common");
  const router = useRouter();
  const qc = useQueryClient();

  const [destination, setDestination] = useState<Destination>("new");
  const [name, setName] = useState(defaultName);
  const [placement, setPlacement] = useState<Placement>("sub");
  const [operation, setOperation] = useState<Operation>("copy");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetFilter, setTargetFilter] = useState("");

  // State is seeded from props on mount; the parent remounts this dialog (via `key`) on each open,
  // so it always starts fresh for the new source set — no reset effect needed.

  const submit = useMutation({
    mutationFn: async (navigate: boolean) => {
      if (destination === "new") {
        const g = await api.galleries.derive(sourceGalleryId, {
          name: name.trim(),
          image_ids: imageIds,
          parent_id: placement === "sub" ? sourceGalleryId : null,
          operation,
        });
        return { targetId: g.id, navigate };
      }
      await api.galleries.transferImages(sourceGalleryId, {
        image_ids: imageIds,
        target_gallery_id: targetId as string,
        operation,
      });
      return { targetId: targetId as string, navigate };
    },
    onSuccess: async ({ targetId: dest, navigate }) => {
      qc.invalidateQueries({ queryKey: ["galleries"] });
      qc.invalidateQueries({ queryKey: ["gallery-images", dest] });
      if (operation === "move") {
        qc.invalidateQueries({ queryKey: ["gallery-images", sourceGalleryId] });
        qc.invalidateQueries({ queryKey: ["gallery", sourceGalleryId] });
        // A moved collection is consumed — its images no longer live in the source gallery.
        if (collectionId) {
          try {
            await api.galleries.deleteCollection(sourceGalleryId, collectionId);
          } catch {
            /* best-effort cleanup */
          }
          qc.invalidateQueries({ queryKey: ["collections", sourceGalleryId] });
        }
      }
      toast.success(t("done", { count: imageIds.length }));
      onOpenChange(false);
      if (navigate) router.push(`/admin/galleries/${dest}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const valid =
    imageIds.length > 0 &&
    (destination === "new" ? name.trim().length > 0 : !!targetId);

  const moveHint = operation === "copy"
    ? t("copyHint")
    : collectionId ? t("moveCollectionHint") : t("moveHint");

  const fq = targetFilter.trim().toLowerCase();
  const targets = (fq ? moveTargets.filter(({ g }) => g.name.toLowerCase().includes(fq)) : moveTargets)
    .filter(({ g }) => g.id !== sourceGalleryId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent is display:grid; `[&>*]:min-w-0` lets the single track shrink so a long
          gallery name / label can't blow the dialog out horizontally on a narrow phone. */}
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>{t("title", { count: imageIds.length })}</DialogTitle>
        </DialogHeader>

        {/* Destination */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t("destination")}</p>
          <Seg
            value={destination}
            onChange={setDestination}
            options={[
              { value: "new", label: t("newGallery"), icon: <FolderPlus size={15} /> },
              { value: "existing", label: t("existingGallery"), icon: <FolderInput size={15} /> },
            ]}
          />
        </div>

        {destination === "new" ? (
          <>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              onKeyDown={(e) => { if (e.key === "Enter" && valid && !submit.isPending) submit.mutate(true); }}
            />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">{t("placement")}</p>
              <Seg
                value={placement}
                onChange={setPlacement}
                options={[
                  { value: "sub", label: t("subOf", { name: sourceGalleryName }), icon: <Layers size={15} /> },
                  { value: "top", label: t("topLevel") },
                ]}
              />
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <div className="relative">
              <Input
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
                placeholder={t("pickPlaceholder")}
                className="h-8 pr-8 text-sm"
                autoFocus
              />
              {targetFilter && <InputClearButton onClick={() => setTargetFilter("")} label={tc("clear")} />}
            </div>
            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noGalleriesMatch")}</p>
            ) : (
              <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                {targets.map(({ g, depth }) => {
                  const active = g.id === targetId;
                  return (
                    <button
                      key={g.id}
                      onClick={() => setTargetId(g.id)}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border text-sm transition-colors",
                        active ? "border-primary ring-1 ring-primary bg-accent" : "border-border hover:bg-accent",
                      )}
                      style={{ paddingLeft: `${12 + depth * 16}px` }}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        {depth > 0 && <CornerDownRight size={12} className="text-muted-foreground/60 shrink-0" />}
                        <span className="font-medium truncate">{g.name}</span>
                      </span>
                      <span className="text-muted-foreground text-xs shrink-0">{t("photos", { count: g.image_count })}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Copy / move */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t("photosLabel")}</p>
          <Seg
            value={operation}
            onChange={setOperation}
            options={[
              { value: "copy", label: t("copy"), icon: <Copy size={15} /> },
              { value: "move", label: t("move"), icon: <FolderInput size={15} /> },
            ]}
          />
          <p className="text-xs text-muted-foreground">{moveHint}</p>
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!valid || submit.isPending} onClick={() => submit.mutate(false)}>
              {destination === "new" ? t("create") : t("apply")}
            </Button>
            <Button size="sm" disabled={!valid || submit.isPending} onClick={() => submit.mutate(true)}>
              {destination === "new" ? t("createOpen") : t("applyOpen")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
