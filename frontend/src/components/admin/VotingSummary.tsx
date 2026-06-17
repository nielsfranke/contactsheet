// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Vote } from "lucide-react";

interface Props {
  galleryId: string;
  /** Render without the self-collapse header/card (e.g. inside a dialog). */
  embedded?: boolean;
}

export function VotingSummary({ galleryId, embedded = false }: Props) {
  const t = useTranslations("admin.voting");
  const [expanded, setExpanded] = useState(embedded);

  const { data } = useQuery({
    queryKey: ["votes-summary", galleryId],
    queryFn: () => api.galleries.votesSummary(galleryId),
    enabled: expanded,
  });

  const reviewers = data?.reviewers ?? [];
  const images = data?.images ?? {};
  const imageCount = Object.keys(images).length;

  return (
    <div className={embedded ? "" : "rounded-lg border border-border bg-card/50"}>
      {!embedded && (
        <button
          className="w-full flex items-center justify-between p-4 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Vote size={15} className="text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{t("title")}</span>
            {reviewers.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {t("reviewerCount", { count: reviewers.length })}
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
        <div className={`overflow-x-auto ${embedded ? "" : "border-t border-border"}`}>
          {reviewers.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-muted-foreground font-normal">{t("image")}</th>
                  {reviewers.map((r) => (
                    <th key={r} className="text-center px-3 py-2 text-muted-foreground font-medium whitespace-nowrap">
                      {r}
                    </th>
                  ))}
                  <th className="text-center px-3 py-2 text-muted-foreground font-normal">{t("totals")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(images).map(([imageId, data]) => {
                  const totals = (data as unknown as { totals: Record<string, number> }).totals ?? {};
                  const reviewerFlags = (data as unknown as { reviewers: Record<string, string> }).reviewers ?? {};
                  const selectCount = (totals.green ?? 0);
                  return (
                    <tr key={imageId}>
                      <td className="px-4 py-2 text-muted-foreground font-mono">
                        {imageId.slice(0, 8)}…
                      </td>
                      {reviewers.map((r) => {
                        const flag = reviewerFlags[r] ?? "none";
                        return (
                          <td key={r} className="text-center px-3 py-2">
                            {flag !== "none" ? (
                              <span className={`inline-block w-3 h-3 rounded-full ${
                                flag === "green" ? "bg-green-500" :
                                flag === "red" ? "bg-red-500" :
                                flag === "yellow" ? "bg-yellow-400" :
                                "bg-blue-400"
                              }`} title={flag} />
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center px-3 py-2">
                        {selectCount > 0 && (
                          <span className="text-green-400">{selectCount}✓</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {imageCount > 0 && (
            <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
              {t("summary", { images: imageCount, reviewers: reviewers.length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
