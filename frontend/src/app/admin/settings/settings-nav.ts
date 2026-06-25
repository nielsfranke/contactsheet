// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { SlidersHorizontal, Palette, Images, LayoutGrid, PanelBottom, Bell, KeyRound, ScanSearch } from "lucide-react";

// Settings nav, grouped by topic so each group is coherent: public identity (Branding), what
// clients get in a gallery (Client galleries), your own admin experience + login (Workspace), and
// instance operations (System). `labelKey` resolves against the `settings.nav` catalog at render.
// Shared by the admin sidebar (desktop nav / mobile drawer) and the mobile settings index list
// (app/admin/settings/page.tsx) so the two never drift.
export const SETTINGS_NAV = [
  {
    labelKey: "brandingGroup",
    items: [
      { href: "/admin/settings/branding", labelKey: "branding", icon: Palette },
      { href: "/admin/settings/footer", labelKey: "footer", icon: PanelBottom },
    ],
  },
  {
    labelKey: "clientGalleriesGroup",
    items: [
      { href: "/admin/settings/gallery-defaults", labelKey: "galleryDefaults", icon: Images },
      { href: "/admin/settings/search", labelKey: "search", icon: ScanSearch },
    ],
  },
  {
    labelKey: "workspaceGroup",
    items: [
      { href: "/admin/settings/workspace", labelKey: "workspace", icon: LayoutGrid },
      { href: "/admin/settings/account", labelKey: "account", icon: KeyRound },
    ],
  },
  {
    labelKey: "systemGroup",
    items: [
      { href: "/admin/settings/notifications", labelKey: "notifications", icon: Bell },
      { href: "/admin/settings/general", labelKey: "general", icon: SlidersHorizontal },
    ],
  },
] as const;
