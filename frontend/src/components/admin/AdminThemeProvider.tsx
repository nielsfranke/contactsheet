// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { applyAdminTheme, resetAdminTheme } from "@/lib/theme";

/**
 * Applies the instance admin theme (light/dark + accent) to <html> while any
 * admin route is mounted. The inline script in app/layout.tsx handles first
 * paint from cached values; this keeps the DOM in sync with the server and
 * restores the always-dark default when leaving the admin surface.
 */
export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  const { data: settings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  useEffect(() => {
    if (!settings) return;
    applyAdminTheme(
      settings.admin_theme === "light" ? "light" : "dark",
      settings.accent_color,
      settings.accent_gradient,
    );
  }, [settings]);

  useEffect(() => resetAdminTheme, []);

  return <>{children}</>;
}
