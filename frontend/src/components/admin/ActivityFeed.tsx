// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Flag,
  Heart,
  MessageCircle,
  PenLine,
  Upload,
  Download,
  Eye,
  Vote,
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { Activity } from "@/lib/types";

const ACTION_ICONS: Record<string, React.ReactNode> = {
  flagged: <Flag size={13} />,
  liked: <Heart size={13} />,
  commented: <MessageCircle size={13} />,
  annotated: <PenLine size={13} />,
  uploaded: <Upload size={13} />,
  downloaded: <Download size={13} />,
  viewed: <Eye size={13} />,
  approved: <Check size={13} />,
  voted: <Vote size={13} />,
  zip_created: <Archive size={13} />,
};

const ACTION_COLORS: Record<string, string> = {
  flagged: "text-yellow-400",
  liked: "text-pink-400",
  commented: "text-blue-400",
  annotated: "text-purple-400",
  uploaded: "text-green-400",
  downloaded: "text-sky-400",
  viewed: "text-muted-foreground",
  approved: "text-emerald-400",
  voted: "text-orange-400",
  zip_created: "text-muted-foreground",
};

const KNOWN_ACTIONS = ["flagged", "liked", "commented", "annotated", "uploaded", "downloaded", "viewed", "approved", "voted", "zip_created"];
const FLAG_WORDS = ["green", "red", "yellow", "blue"];

function ActionLabel({ action, meta }: { action: string; meta: Record<string, unknown> | null }) {
  const t = useTranslations("admin.activity");
  const flag = meta?.flag as string | undefined;
  if (action === "flagged" && flag) {
    const colors: Record<string, string> = {
      green: "text-green-400",
      red: "text-red-400",
      yellow: "text-yellow-400",
      blue: "text-blue-400",
    };
    return (
      <span>
        {t("actions.flagged")}{" "}
        <span className={colors[flag] ?? "text-foreground"}>
          {FLAG_WORDS.includes(flag) ? t(`flagColors.${flag}`) : flag}
        </span>
      </span>
    );
  }
  if (action === "commented" && meta?.preview) {
    return <span>{t("commentedPreview", { preview: String(meta.preview).slice(0, 40) })}</span>;
  }
  if (action === "annotated" && meta?.preview) {
    return <span>{t("annotatedPreview", { preview: String(meta.preview).slice(0, 40) })}</span>;
  }
  if ((action === "downloaded" || action === "uploaded") && Number(meta?.count) > 0) {
    return <span>{t(`${action}Count`, { count: Number(meta?.count) })}</span>;
  }
  return <span>{KNOWN_ACTIONS.includes(action) ? t(`actions.${action}`) : action}</span>;
}

// Compact relative time, localized (uses the admin.activity translator passed in).
function timeAgo(iso: string, t: (key: string, values?: Record<string, number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return t("secondsAgo", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("minutesAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("hoursAgo", { n: h });
  return t("daysAgo", { n: Math.floor(h / 24) });
}

interface Props {
  galleryId: string;
  /** Render without the self-collapse header/card (e.g. inside a dialog). */
  embedded?: boolean;
}

export function ActivityFeed({ galleryId, embedded = false }: Props) {
  const t = useTranslations("admin.activity");
  const [expanded, setExpanded] = useState(embedded);
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ["activity", galleryId, page],
    queryFn: () => api.galleries.activity(galleryId, page),
    enabled: expanded,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = total > page * 20;

  return (
    <div className={embedded ? "" : "rounded-lg border border-border bg-card/50"}>
      {!embedded && (
        <button
          className="w-full flex items-center justify-between p-4 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{t("title")}</span>
            {total > 0 && (
              <Badge variant="secondary" className="text-xs">
                {total}
              </Badge>
            )}
          </div>
          {expanded ? (
            <ChevronUp size={16} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground" />
          )}
        </button>
      )}

      {expanded && (
        <div className={embedded ? "" : "border-t border-border"}>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item: Activity) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`mt-0.5 flex-shrink-0 ${ACTION_COLORS[item.action] ?? "text-muted-foreground"}`}>
                    {ACTION_ICONS[item.action] ?? <span className="w-3 h-3 rounded-full bg-muted-foreground inline-block" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-foreground font-medium">{item.author}</span>{" "}
                    <span className="text-sm text-muted-foreground">
                      <ActionLabel action={item.action} meta={item.meta} />
                    </span>
                    {item.ip && (
                      <span
                        className="ml-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                        title={t("ipTitle")}
                      >
                        {item.ip}
                      </span>
                    )}
                  </div>
                  <time className="flex-shrink-0 text-xs text-muted-foreground/70 mt-0.5">{timeAgo(item.created_at, t)}</time>
                </li>
              ))}
            </ul>
          )}
          {(hasMore || page > 1) && (
            <div className="flex gap-2 justify-center px-4 py-3 border-t border-border">
              {page > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t("previous")}
                </Button>
              )}
              {hasMore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("loadMore")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
