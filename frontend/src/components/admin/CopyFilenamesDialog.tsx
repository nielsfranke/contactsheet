// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Separator = "space" | "comma";

// `hint` carries product names (not translated); `labelKey` resolves against admin.copyFilenames.
const SEPARATORS: { value: Separator; labelKey: string; hint: string }[] = [
  { value: "space", labelKey: "space", hint: "Capture One, Photo Mechanic" },
  { value: "comma", labelKey: "comma", hint: "Lightroom" },
];

// Strip any directory components (e.g. "shoot/IMG_1234.jpg" → "IMG_1234.jpg").
// Folder uploads can leave a relative path in original_filename on older rows.
// Handles both POSIX and Windows separators.
function baseName(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() ?? name;
}

// Strip a single trailing extension (e.g. "IMG_1234.jpg" → "IMG_1234"). Leaves
// dotless names and leading dots ("..cfg") untouched.
function stripExtension(name: string): string {
  return name.replace(/\.[^.\\/]+$/, "");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filenames of the currently filtered images, in display order. */
  filenames: string[];
  /** Whether a filter is active — drives the heading copy. */
  filtered: boolean;
}

export function CopyFilenamesDialog({ open, onOpenChange, filenames, filtered }: Props) {
  const t = useTranslations("admin.copyFilenames");
  const tc = useTranslations("common");
  const [separator, setSeparator] = useState<Separator>("space");
  const [excludeExt, setExcludeExt] = useState(true);
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    const bases = filenames.map(baseName);
    const names = excludeExt ? bases.map(stripExtension) : bases;
    return names.join(separator === "space" ? " " : ", ");
  }, [filenames, separator, excludeExt]);

  async function copy() {
    if (await copyText(text)) {
      setCopied(true);
      toast.success(t("copiedToast", { count: filenames.length }));
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t("clipboardError"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {filtered ? t("countFiltered", { count: filenames.length }) : t("count", { count: filenames.length })}. {t("pasteHint")}
          </DialogDescription>
        </DialogHeader>

        {/* Separator */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">{t("separator")}</p>
          <div className="grid grid-cols-2 gap-2">
            {SEPARATORS.map((s) => {
              const active = separator === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeparator(s.value)}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">{t(s.labelKey)}</span>
                  <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Exclude extensions */}
        <label className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5 cursor-pointer">
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-foreground">{t("excludeExt")}</span>
            <span className="block text-[11px] text-muted-foreground">
              {t.rich("excludeHint", { code: (c) => <code className="font-mono">{c}</code> })}
            </span>
          </span>
          <Switch checked={excludeExt} onCheckedChange={setExcludeExt} className="mt-0.5 shrink-0" />
        </label>

        {/* Preview */}
        <textarea
          readOnly
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          placeholder={t("emptyPlaceholder")}
          className="h-32 w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {tc("close")}
          </Button>
          <Button size="sm" onClick={copy} disabled={filenames.length === 0}>
            {copied ? <Check size={15} className="mr-1.5" /> : <Copy size={15} className="mr-1.5" />}
            {copied ? t("copied") : t("copyToClipboard")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
