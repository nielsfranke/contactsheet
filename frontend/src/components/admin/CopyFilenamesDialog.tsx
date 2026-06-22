// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { copyText, downloadTextFile } from "@/lib/utils";
import { buildNameList, buildSelectsCsv, slugify, type Separator } from "@/lib/filename-export";
import type { ImageResponse } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FileFormat = "txt" | "csv";

// `hint` carries product names (not translated); `labelKey` resolves against admin.copyFilenames.
const SEPARATORS: { value: Separator; labelKey: string; hint: string }[] = [
  { value: "space", labelKey: "space", hint: "Capture One, Photo Mechanic" },
  { value: "comma", labelKey: "comma", hint: "Lightroom" },
];

const FORMATS: { value: FileFormat; labelKey: string; hintKey: string }[] = [
  { value: "txt", labelKey: "formatTxt", hintKey: "formatTxtHint" },
  { value: "csv", labelKey: "formatCsv", hintKey: "formatCsvHint" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently filtered + sorted images, in display order. */
  images: ImageResponse[];
  /** Gallery name — used to name the downloaded file. */
  galleryName: string;
  /** Whether a filter is active — drives the heading copy. */
  filtered: boolean;
  /** Number of descendant galleries — when > 0 the "include subgalleries" row is shown. */
  subGalleryCount: number;
  /** Whether the subgalleries option can be applied (false during a collection / search view). */
  subsAvailable: boolean;
  /** Subtree images are still loading. */
  subsLoading: boolean;
  includeSubs: boolean;
  onIncludeSubsChange: (value: boolean) => void;
}

export function CopyFilenamesDialog({
  open,
  onOpenChange,
  images,
  galleryName,
  filtered,
  subGalleryCount,
  subsAvailable,
  subsLoading,
  includeSubs,
  onIncludeSubsChange,
}: Props) {
  const t = useTranslations("admin.copyFilenames");
  const tc = useTranslations("common");
  const [separator, setSeparator] = useState<Separator>("space");
  const [excludeExt, setExcludeExt] = useState(true);
  const [format, setFormat] = useState<FileFormat>("txt");
  const [copied, setCopied] = useState(false);

  const count = images.length;

  // The clipboard / .txt payload — respects the separator + extension toggles.
  const text = useMemo(
    () => buildNameList(images, separator, excludeExt),
    [images, separator, excludeExt],
  );

  // The .csv payload — one row per image, filename column honours `excludeExt`.
  const csv = useMemo(() => buildSelectsCsv(images, excludeExt), [images, excludeExt]);

  async function copy() {
    if (await copyText(text)) {
      setCopied(true);
      toast.success(t("copiedToast", { count }));
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t("clipboardError"));
    }
  }

  function download() {
    const stem = `${slugify(galleryName)}-selects`;
    if (format === "csv") {
      // Lead with a UTF-8 BOM so Excel reads umlauts in filenames correctly.
      downloadTextFile(`${stem}.csv`, "\uFEFF" + csv, "text/csv");
    } else {
      downloadTextFile(`${stem}.txt`, text, "text/plain");
    }
    toast.success(t("downloadedToast", { count }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {filtered ? t("countFiltered", { count }) : t("count", { count })}. {t("pasteHint")}
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

        {/* Include subgalleries — only shown when the gallery has descendants */}
        {subGalleryCount > 0 && (
          <label
            className={`flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5 ${
              subsAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-60"
            }`}
          >
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{t("includeSubs")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {!subsAvailable
                  ? t("includeSubsDisabled")
                  : subsLoading
                    ? t("includeSubsLoading")
                    : t("includeSubsHint", { count: subGalleryCount })}
              </span>
            </span>
            <Switch
              checked={includeSubs && subsAvailable}
              disabled={!subsAvailable}
              onCheckedChange={onIncludeSubsChange}
              className="mt-0.5 shrink-0"
            />
          </label>
        )}

        {/* Preview */}
        <textarea
          readOnly
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          placeholder={t("emptyPlaceholder")}
          className="h-32 w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />

        {/* Download a file */}
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground">{t("downloadSection")}</p>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map((f) => {
              const active = format === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFormat(f.value)}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-muted-foreground"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">{t(f.labelKey)}</span>
                  <span className="block text-[11px] text-muted-foreground">{t(f.hintKey)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {tc("close")}
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={count === 0}>
            <Download size={15} className="mr-1.5" />
            {t("download")}
          </Button>
          <Button size="sm" onClick={copy} disabled={count === 0}>
            {copied ? <Check size={15} className="mr-1.5" /> : <Copy size={15} className="mr-1.5" />}
            {copied ? t("copied") : t("copyToClipboard")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
