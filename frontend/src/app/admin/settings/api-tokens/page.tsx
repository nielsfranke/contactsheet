// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { api, getErrorCode } from "@/lib/api";
import type { ApiToken, ApiTokenCreated, ApiTokenScope } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/chrome/ConfirmDialog";

const ALL_SCOPES: ApiTokenScope[] = ["galleries:read", "galleries:write", "images:write"];

// Expiry presets → days (0 = never).
const EXPIRY_DAYS = [0, 30, 90, 365] as const;

type T = ReturnType<typeof useTranslations>;

function errToast(err: unknown, te: T, fallback: string) {
  const code = getErrorCode(err);
  toast.error(code && te.has(code) ? te(code) : fallback);
}

export default function ApiTokensPage() {
  const t = useTranslations("settings.apiTokens");
  const te = useTranslations("errors");

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
      </div>
      <CreateSection t={t} te={te} />
      <TokenList t={t} te={te} />
    </div>
  );
}

function CreateSection({ t, te }: { t: T; te: T }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Record<ApiTokenScope, boolean>>({
    "galleries:read": true,
    "galleries:write": true,
    "images:write": true,
  });
  const [expiryDays, setExpiryDays] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = ALL_SCOPES.filter((s) => scopes[s]);
  const canSubmit = !saving && name.trim().length > 0 && selected.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const expiresAt =
        expiryDays === 0 ? null : new Date(Date.now() + expiryDays * 86_400_000).toISOString();
      const token = await api.apiTokens.create(name.trim(), selected, expiresAt);
      setCreated(token);
      setCopied(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (err: unknown) {
      errToast(err, te, t("createFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function copySecret() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">{t("createSection")}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t("pluginHint")}</p>
      </div>

      {created && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("createdTitle")}</p>
            <p className="text-xs text-destructive mt-1">{t("createdWarning")}</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted px-3 py-2 text-xs font-mono text-foreground">
              {created.token}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copySecret}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="ml-1.5">{copied ? t("copied") : t("copy")}</span>
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCreated(null)}>
            {t("dismiss")}
          </Button>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="token-name">{t("nameLabel")}</Label>
          <Input
            id="token-name"
            value={name}
            placeholder={t("namePlaceholder")}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>{t("scopesLabel")}</Label>
          {ALL_SCOPES.map((scope) => (
            <div key={scope} className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm text-foreground">{t(`scope.${scope}`)}</p>
                <p className="text-xs text-muted-foreground">{t(`scopeHint.${scope}`)}</p>
              </div>
              <Switch
                checked={scopes[scope]}
                onCheckedChange={(v) => setScopes((prev) => ({ ...prev, [scope]: v }))}
              />
            </div>
          ))}
          {selected.length === 0 && <p className="text-xs text-destructive">{t("needScope")}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="token-expiry">{t("expiryLabel")}</Label>
          <select
            id="token-expiry"
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
          >
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t("expiryNever") : t("expiryDays", { count: d })}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" disabled={!canSubmit}>
          {saving ? t("creating") : t("create")}
        </Button>
      </form>
    </div>
  );
}

function TokenList({ t, te }: { t: T; te: T }) {
  const qc = useQueryClient();
  const { data: tokens, isLoading } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api.apiTokens.list(),
  });
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [pending, setPending] = useState(false);

  async function confirmRevoke() {
    if (!revoking) return;
    setPending(true);
    try {
      await api.apiTokens.revoke(revoking.id);
      toast.success(t("revoked"));
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    } catch (err: unknown) {
      errToast(err, te, t("revokeFailed"));
    } finally {
      setPending(false);
    }
  }

  const fmt = (s: string) => new Date(s).toLocaleDateString();

  return (
    <div className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
      <h2 className="text-sm font-medium text-foreground">{t("listTitle")}</h2>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : !tokens || tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {tokens.map((tok) => (
            <li key={tok.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{tok.name}</span>
                  <code className="text-xs font-mono text-muted-foreground">{tok.prefix}…</code>
                </div>
                <div className="flex flex-wrap gap-1">
                  {tok.scopes.map((s) => (
                    <Badge key={s} variant="secondary" className="text-xs">
                      {t(`scope.${s}`)}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("createdAt", { date: fmt(tok.created_at) })}
                  {" · "}
                  {tok.last_used_at ? t("lastUsed", { date: fmt(tok.last_used_at) }) : t("neverUsed")}
                  {tok.expires_at && ` · ${t("expiresAt", { date: fmt(tok.expires_at) })}`}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(tok)}>
                {t("revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t("revokeTitle")}
        description={revoking ? t("revokeDescription", { name: revoking.name }) : undefined}
        confirmLabel={t("revoke")}
        destructive
        pending={pending}
        onConfirm={confirmRevoke}
      />
    </div>
  );
}
