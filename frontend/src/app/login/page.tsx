// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { markAuthenticated } from "@/lib/auth";
import { applyAdminTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.setup.status().then((s) => {
      if (!s.setup_complete) router.replace("/setup");
      applyAdminTheme(s.admin_theme === "dark" ? "dark" : "light", s.accent_color, s.accent_gradient);
    }).catch(() => {});
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.auth.login(username, password, remember);
      markAuthenticated();
      router.replace("/admin/galleries");
    } catch {
      toast.error(t("invalidCredentials"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl text-center">ContactSheet</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="username">{t("username")}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 rounded border-input accent-primary"
              />
              {t("rememberMe")}
            </label>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("signingIn") : t("signIn")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
