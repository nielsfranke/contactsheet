// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { applyAdminTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function SetupPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.setup.status().then((s) => {
      if (s.setup_complete) router.replace("/login");
      applyAdminTheme(s.admin_theme === "dark" ? "dark" : "light", s.accent_color, s.accent_gradient);
    }).catch(() => {});
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error(t("passwordsMismatch"));
      return;
    }
    setLoading(true);
    try {
      await api.setup.complete(username, password);
      toast.success(t("setupComplete"));
      router.replace("/login");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("setupFailed");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl text-center">{t("setupTitle")}</CardTitle>
          <CardDescription className="text-center">
            {t("setupDescription")}
          </CardDescription>
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
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirm">{t("confirmPassword")}</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("settingUp") : t("createAccount")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
