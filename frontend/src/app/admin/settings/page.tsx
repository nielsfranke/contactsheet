// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { SETTINGS_NAV } from "./settings-nav";

// Settings entry point. On desktop the sidebar already lists every section, so we keep the old
// behaviour and land on the first one. On mobile the sidebar is an off-canvas drawer — landing
// straight in Branding hid the other sections ("where are the other settings?"), so this page is
// the native section list instead. The list is md:hidden and the redirect only fires on md+, so
// each viewport sees exactly one of the two.
export default function SettingsIndexPage() {
  const router = useRouter();
  const tShell = useTranslations("admin.shell");
  const tNav = useTranslations("settings.nav");

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      router.replace("/admin/settings/branding");
    }
  }, [router]);

  return (
    <div className="md:hidden p-4 space-y-6">
      <h1 className="text-lg font-semibold">{tShell("settings")}</h1>
      {SETTINGS_NAV.map((group) => (
        <div key={group.labelKey} className="space-y-1.5">
          <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {tNav(group.labelKey)}
          </p>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {group.items.map(({ href, labelKey, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/50 active:bg-accent"
              >
                <Icon size={18} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 text-sm">{tNav(labelKey)}</span>
                <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
