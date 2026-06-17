// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Metadata, Viewport } from "next";
import { Montserrat, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import { GALLERY_FONT_VARIABLES } from "@/lib/gallery-fonts";

const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ContactSheet",
  description: "Self-hosted photo delivery",
  applicationName: "ContactSheet",
  manifest: "/api/branding/manifest.webmanifest",
  icons: {
    // Rendered by the backend from the instance branding (logo → monogram → contact-sheet default).
    icon: [
      { url: "/api/branding/favicon.ico", sizes: "any" },
      { url: "/api/branding/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/api/branding/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/api/branding/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ContactSheet",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Locale comes from the cookie / Accept-Language (see src/i18n/request.ts); messages are
  // inherited by NextIntlClientProvider from the request config (no explicit prop needed).
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${montserrat.variable} ${geistMono.variable} ${GALLERY_FONT_VARIABLES} h-full antialiased dark`} suppressHydrationWarning>
      <head>
        {/* Pre-hydration theme script. Public gallery pages (`/g/…`) drop the root `dark` so the
            per-gallery `.gallery-scope` owns light/dark tone (otherwise shadcn `dark:` variants leak
            into a bright gallery — e.g. a grey filter input); the gallery's own pre-gallery states
            (password / expired / loading) carry their own dark styling. The admin/login/setup
            screens follow the instance theme (default light) before first paint. Keys mirror
            src/lib/theme.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=location.pathname;var d=document.documentElement;if(p.indexOf("/g/")===0){d.classList.remove("dark");return;}if(p.indexOf("/admin")!==0&&p.indexOf("/login")!==0&&p.indexOf("/setup")!==0)return;if(localStorage.getItem("cs-admin-theme")!=="dark")d.classList.remove("dark");var a=localStorage.getItem("cs-admin-accent");if(a){d.style.setProperty("--primary",a);d.style.setProperty("--ring",a);var f=localStorage.getItem("cs-admin-accent-fg");if(f)d.style.setProperty("--primary-foreground",f)}if(localStorage.getItem("cs-admin-accent-gradient")==="1")d.classList.add("accent-gradient")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
          <Toaster richColors position="bottom-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
