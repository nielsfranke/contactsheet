// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { DuplicateAction } from "@/lib/types";
import type { DuplicatePrompt } from "@/hooks/useImageUpload";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const ACTIONS: DuplicateAction[] = ["replace", "keep_both", "skip"];

interface Props {
  /** The open prompt from `useImageUpload`, or null when there's nothing to resolve. */
  prompt: DuplicatePrompt | null;
}

/**
 * Prompts the photographer when an upload's filenames already exist in the gallery. A batch-level
 * default (Replace / Keep both / Skip) applies to every collision, with an optional per-file
 * override. Resolving hands `useImageUpload` a `{ filename → action }` map (or null to cancel the
 * whole batch). "Keep both" is the default — it never destroys existing photos.
 */
export function DuplicateUploadDialog({ prompt }: Props) {
  return (
    <Dialog open={prompt !== null} onOpenChange={(o) => { if (!o) prompt?.resolve(null); }}>
      <DialogContent className="sm:max-w-lg">
        {/* Keyed by the batch's filenames so a fresh prompt resets the controls to defaults. */}
        {prompt && <PromptBody key={prompt.collisions.map((c) => c.name).join("|")} prompt={prompt} />}
      </DialogContent>
    </Dialog>
  );
}

function PromptBody({ prompt }: { prompt: DuplicatePrompt }) {
  const t = useTranslations("admin.duplicateUpload");
  const [batch, setBatch] = useState<DuplicateAction>("keep_both");
  const [overrides, setOverrides] = useState<Record<string, DuplicateAction>>({});
  const [expanded, setExpanded] = useState(false);

  const count = prompt.collisions.length;

  function confirm() {
    const actions: Record<string, DuplicateAction> = {};
    for (const c of prompt.collisions) actions[c.name] = overrides[c.name] ?? batch;
    prompt.resolve(actions);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description", { count })}</DialogDescription>
      </DialogHeader>

      {/* Batch-level default — applied to every collision unless a per-file override is set. */}
      <div className="flex gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setBatch(a)}
            className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
              batch === a
                ? "border-primary bg-primary/5 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground"
            }`}
          >
            {t(`action.${a}`)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{t(`hint.${batch}`)}</p>

      {/* Per-file override — collapsed by default so a big batch stays a one-click decision. */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? t("hideFiles", { count }) : t("showFiles", { count })}
        </button>
        {expanded && (
          <ul className="mt-2 max-h-[34vh] space-y-1.5 overflow-y-auto">
            {prompt.collisions.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate" title={c.name}>
                  {c.name}
                  {c.count > 1 && (
                    <span className="ml-1 text-xs text-muted-foreground">{t("copies", { count: c.count })}</span>
                  )}
                </span>
                <select
                  value={overrides[c.name] ?? batch}
                  onChange={(e) =>
                    setOverrides((o) => ({ ...o, [c.name]: e.target.value as DuplicateAction }))
                  }
                  className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(`action.${a}`)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => prompt.resolve(null)}>
          {t("cancel")}
        </Button>
        <Button onClick={confirm}>{t("confirm")}</Button>
      </DialogFooter>
    </>
  );
}
