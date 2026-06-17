// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { api, getErrorCode } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface Props {
  shareToken: string;
  onSuccess: (jwt: string) => void;
}

export function PasswordGate({ shareToken, onSuccess }: Props) {
  const t = useTranslations("gallery.password");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await api.public.auth(shareToken, password);
      onSuccess(result.access_token);
    } catch (err: unknown) {
      // Prefer the stable backend code; fall back to the 401 status for older responses.
      const code = getErrorCode(err);
      const status = (err as { status?: number })?.status;
      const wrong = code === "gallery_password_invalid" || (code === undefined && status === 401);
      toast.error(wrong ? t("wrong") : t("error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Card className="w-full max-w-sm bg-zinc-900 border-zinc-800 text-zinc-100">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock size={18} className="text-zinc-400" />
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-zinc-300">{t("label")}</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                className="bg-zinc-800 border-zinc-700 text-zinc-100"
                placeholder={t("placeholder")}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("verifying") : t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
