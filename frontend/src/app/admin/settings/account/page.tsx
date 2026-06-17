// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, getErrorCode } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const MIN_LENGTH = 8;

export default function AccountSettingsPage() {
  const t = useTranslations("settings.account");
  const te = useTranslations("errors");

  return (
    <div className="p-6 max-w-xl space-y-6">
      <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
      <UsernameSection t={t} te={te} />
      <PasswordSection t={t} te={te} />
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

function errToast(err: unknown, te: T, fallback: string) {
  const code = getErrorCode(err);
  toast.error(code && te.has(code) ? te(code) : fallback);
}

function UsernameSection({ t, te }: { t: T; te: T }) {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["auth-me"], queryFn: () => api.auth.me() });

  const [username, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const current = me?.username ?? "";
  const value = username ?? current;
  const trimmed = value.trim();
  const canSubmit = !saving && trimmed.length > 0 && trimmed !== current && password.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const { username: saved } = await api.auth.changeUsername(trimmed, password);
      qc.setQueryData(["auth-me"], { username: saved });
      setUsername(null);
      setPassword("");
      toast.success(t("usernameSaved"));
    } catch (err: unknown) {
      errToast(err, te, t("usernameFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">{t("usernameSection")}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t("usernameDescription")}</p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="username">{t("username")}</Label>
        <Input
          id="username"
          autoComplete="username"
          value={value}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="username-current-password">{t("current")}</Label>
        <Input
          id="username-current-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={!canSubmit}>
        {saving ? t("saving") : t("usernameSubmit")}
      </Button>
    </form>
  );
}

function PasswordSection({ t, te }: { t: T; te: T }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !saving && current.length > 0 && next.length >= MIN_LENGTH && next === confirm;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.auth.changePassword(current, next);
      toast.success(t("success"));
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err: unknown) {
      errToast(err, te, t("failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">{t("passwordSection")}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t("description")}</p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="current-password">{t("current")}</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="new-password">{t("new")}</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className={tooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {t("minLength", { count: MIN_LENGTH })}
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="confirm-password">{t("confirm")}</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p className="text-xs text-destructive">{t("mismatch")}</p>}
      </div>

      <p className="text-xs text-muted-foreground">{t("signsOutOthers")}</p>

      <Button type="submit" disabled={!canSubmit}>
        {saving ? t("saving") : t("submit")}
      </Button>
    </form>
  );
}
