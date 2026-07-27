// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useReviewerStore } from "@/store/reviewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";

interface Props {
  onConfirmed: (name: string) => void;
  /** Override the default team-voting copy (title / body / submit label). */
  title?: string;
  body?: string;
  submitLabel?: string;
}

export function ReviewerNamePrompt({ onConfirmed, title, body, submitLabel }: Props) {
  const t = useTranslations("gallery.reviewer");
  const [value, setValue] = useState("");
  const setName = useReviewerStore((s) => s.setName);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Hand focus back to whatever opened the prompt when it goes away.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    return () => trigger?.focus?.();
  }, []);

  // Minimal focus trap — the prompt is modal (aria-modal) but the page behind would otherwise
  // still be reachable through the tab order.
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const els = Array.from(
      boxRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])") ?? [],
    );
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setName(trimmed);
    onConfirmed(trimmed);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
    >
      <div ref={boxRef} className="bg-popover text-popover-foreground border border-border rounded-xl p-8 w-full max-w-sm space-y-5 shadow-2xl">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center">
            <Users size={22} className="text-blue-500" />
          </div>
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-foreground">{title ?? t("title")}</h2>
            <p className="text-sm text-muted-foreground mt-1">{body ?? t("body")}</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("placeholder")}
            className="text-center"
            maxLength={255}
          />
          <Button type="submit" className="w-full" disabled={!value.trim()}>
            {submitLabel ?? t("submit")}
          </Button>
        </form>
      </div>
    </div>
  );
}
