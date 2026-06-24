// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isAuthenticated, clearAuthenticated } from "@/lib/auth";
import { GalleryTree } from "@/components/admin/GalleryTree";
import { AdminThemeProvider } from "@/components/admin/AdminThemeProvider";
import { AdminDndProvider } from "@/components/admin/AdminDnd";
import { useAdminMobileHeader } from "@/store/adminMobileHeader";
import { resolveOpenerFont } from "@/lib/gallery-fonts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LogOut, Settings, ChevronLeft, Menu } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SETTINGS_NAV } from "./settings/settings-nav";

/** Closes the mobile drawer on any navigation (path or ?folder= change). Isolated in a
 *  Suspense boundary because useSearchParams opts the subtree out of prerendering. */
function CloseDrawerOnNav({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    onChange();
  }, [pathname, params, onChange]);
  return null;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const tNav = useTranslations("settings.nav");
  const tShell = useTranslations("admin.shell");
  const tCommon = useTranslations("common");
  const [checked, setChecked] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  // Per-route override for the mobile top bar — the gallery detail page sets a "go up" context here
  // so the bar shows that instead of a second stacked up-nav row (see useAdminMobileHeader).
  const mobileHeaderNav = useAdminMobileHeader((s) => s.nav);

  // Verify session is still valid against the server
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    api.auth.me().then(() => setChecked(true)).catch(() => {
      clearAuthenticated();
      router.replace("/login");
    });
  }, [router]);

  // Esc closes the mobile drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const pathname = usePathname();

  const { data: galleries = [] } = useQuery({
    queryKey: ["galleries"],
    queryFn: () => api.galleries.list(),
    enabled: checked,
  });

  const { data: appSettings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
    enabled: checked,
  });

  async function handleLogout() {
    setSigningOut(true);
    try {
      await api.auth.logout();
    } catch {
      // ignore — cookie will be gone regardless
    }
    clearAuthenticated();
    router.replace("/login");
    toast.success(tShell("loggedOut"));
  }

  async function handleLogoutAll() {
    setSigningOut(true);
    try {
      await api.auth.logoutAll();
    } catch {
      // ignore — local cookie is cleared regardless; the token generation bump is best-effort
    }
    clearAuthenticated();
    router.replace("/login");
    toast.success(tShell("loggedOutEverywhere"));
  }

  if (!checked) return null;

  // On a gallery detail page the per-gallery sidebar (portaled into the slot below)
  // replaces the gallery tree, keeping a single two-column layout.
  const isGalleryDetail = /^\/admin\/galleries\/[^/]+$/.test(pathname);
  // On settings pages the sidebar shows the settings sections instead.
  const isSettings = pathname.startsWith("/admin/settings");
  // A settings *section* (not the mobile index list) — drives the mobile header back-arrow to the
  // section list, so the other settings are reachable without opening the drawer.
  const isSettingsSection = isSettings && pathname !== "/admin/settings";

  const instanceName = appSettings?.instance_name ?? "ContactSheet";
  // Masthead branding (top-left box). With no logo uploaded we always fall back to the name so the
  // box is never empty, even if brand_display is "logo_only".
  const brandDisplay = appSettings?.brand_display ?? "logo_name";
  const hasLogo = !!appSettings?.logo_url;
  const showLogo = hasLogo && brandDisplay !== "name_only";
  const showName = !showLogo || brandDisplay === "logo_name";
  const tagline = appSettings?.tagline?.trim();
  const nameStyle = {
    ...resolveOpenerFont(appSettings?.brand_font),
    ...(appSettings?.brand_color ? { color: appSettings.brand_color } : {}),
  };
  const logo = showLogo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={appSettings!.logo_url!}
      alt={instanceName}
      className={`${brandDisplay === "logo_only" ? "h-9" : "h-8"} w-auto max-w-[180px] object-contain`}
    />
  ) : null;

  // The sidebar's contents — rendered once, in a single <aside> that is a static column on
  // md+ and an off-canvas drawer below md. Keeping it a single element (not a desktop copy +
  // a mobile copy) means the detail page's portal slot below never changes identity.
  const sidebarInner = (
    <>
      <Link
        href="/admin/galleries"
        title={instanceName}
        className="flex h-16 items-center gap-2 px-4 border-b border-sidebar-border hover:bg-sidebar-accent/50 transition-colors overflow-hidden"
      >
        {logo}
        {showName && (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold" style={nameStyle}>{instanceName}</span>
            {tagline && (
              <span className="truncate text-xs text-muted-foreground">{tagline}</span>
            )}
          </span>
        )}
      </Link>
      <div className="flex-1 overflow-y-auto py-2">
        {isGalleryDetail || isSettings ? (
          <>
            <Link
              href="/admin/galleries"
              className="mx-2 mb-1 flex items-center gap-1 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
            >
              <ChevronLeft size={14} /> {tShell("allGalleries")}
            </Link>
            {isSettings ? (
              <nav className="px-2 pt-2 space-y-4">
                {SETTINGS_NAV.map((group) => (
                  <div key={group.labelKey} className="space-y-0.5">
                    <p className="px-2 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {tNav(group.labelKey)}
                    </p>
                    {group.items.map(({ href, labelKey, icon: Icon }) => (
                      <Link
                        key={href}
                        href={href}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                          pathname === href
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                        }`}
                      >
                        <Icon size={15} /> {tNav(labelKey)}
                      </Link>
                    ))}
                  </div>
                ))}
              </nav>
            ) : (
              <div id="gallery-admin-sidebar-slot" />
            )}
          </>
        ) : (
          <GalleryTree galleries={galleries} />
        )}
      </div>
      <div className="px-3 py-3 border-t border-sidebar-border space-y-1">
        <Link href="/admin/settings">
          <Button
            variant="ghost"
            size="sm"
            className={`w-full justify-start ${
              isSettings
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Settings size={16} className="mr-2" /> {tShell("settings")}
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={() => setSignOutOpen(true)}
        >
          <LogOut size={16} className="mr-2" /> {tShell("signOut")}
        </Button>
      </div>

      <Dialog open={signOutOpen} onOpenChange={(o) => { if (!signingOut) setSignOutOpen(o); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tShell("signOut")}</DialogTitle>
            <DialogDescription>{tShell("signOutBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignOutOpen(false)} disabled={signingOut}>
              {tCommon("cancel")}
            </Button>
            <Button variant="outline" onClick={handleLogoutAll} disabled={signingOut}>
              {tShell("signOutAllDevices")}
            </Button>
            <Button onClick={handleLogout} disabled={signingOut}>
              {tShell("signOutThisDevice")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return (
    <AdminThemeProvider>
    <AdminDndProvider>
    <div className="flex h-dvh bg-background text-foreground overflow-hidden">
      {/* Sidebar: static column on md+, off-canvas drawer below md (single mounted element). */}
      <aside
        className={cn(
          "flex w-72 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:max-w-[84vw] max-md:shadow-xl max-md:transition-transform max-md:duration-200",
          drawerOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
        )}
      >
        {sidebarInner}
      </aside>

      {/* Mobile backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeDrawer}
          aria-hidden
        />
      )}

      {/* Main column */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 text-sidebar-foreground md:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
            <Menu size={20} />
          </Button>
          {mobileHeaderNav ? (
            // Gallery detail context: back-to-parent in place of the global brand (one row, not two).
            <Link href={mobileHeaderNav.href} className="flex items-center gap-1 min-w-0">
              <ChevronLeft size={20} className="shrink-0 text-muted-foreground" />
              <span className="font-semibold truncate">{mobileHeaderNav.label}</span>
            </Link>
          ) : isSettingsSection ? (
            // Settings section: back to the mobile settings list (the sidebar nav is in the drawer).
            <Link href="/admin/settings" className="flex items-center gap-1 min-w-0">
              <ChevronLeft size={20} className="shrink-0 text-muted-foreground" />
              <span className="font-semibold truncate">{tShell("settings")}</span>
            </Link>
          ) : (
            <Link href="/admin/galleries" className="flex items-center gap-2 min-w-0">
              {logo}
              <span className="font-semibold truncate">{instanceName}</span>
            </Link>
          )}
        </header>
        <main className="flex-1 overflow-y-auto overscroll-contain min-w-0">
          {children}
        </main>
      </div>
    </div>
    <Suspense fallback={null}>
      <CloseDrawerOnNav onChange={closeDrawer} />
    </Suspense>
    </AdminDndProvider>
    </AdminThemeProvider>
  );
}
