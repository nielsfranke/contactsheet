// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface NavRef {
  name: string;
  share_token: string;
}

/**
 * Slim navigation row for nested galleries:
 * `[Ancestor › … › Parent ›] **Current** › child · child`.
 * Replaces the inline "Back"/cover cards as the primary nav on content galleries.
 */
export function GalleryBreadcrumb({
  ancestors,
  current,
  items,
  bright,
}: {
  ancestors: NavRef[];
  current: string;
  items: NavRef[];
  bright: boolean;
}) {
  if (ancestors.length === 0 && items.length === 0) return null;

  const linkCls = bright
    ? "text-zinc-500 hover:text-zinc-900"
    : "text-zinc-400 hover:text-zinc-100";
  const currentCls = bright ? "text-zinc-900" : "text-zinc-100";
  const sep = bright ? "text-zinc-300" : "text-zinc-600";

  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm">
      {ancestors.map((a) => (
        <span key={a.share_token} className="flex items-center gap-x-2.5">
          <Link href={`/g/${a.share_token}`} className={`${linkCls} transition-colors`}>
            {a.name}
          </Link>
          <ChevronRight size={14} className={sep} />
        </span>
      ))}
      <span className={`font-semibold ${currentCls}`}>{current}</span>
      {items.length > 0 && <ChevronRight size={14} className={sep} />}
      {items.map((c) => (
        <Link key={c.share_token} href={`/g/${c.share_token}`} className={`${linkCls} transition-colors`}>
          {c.name}
        </Link>
      ))}
    </nav>
  );
}
