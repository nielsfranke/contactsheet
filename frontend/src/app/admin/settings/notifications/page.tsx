// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { SettingsPageSkeleton } from "@/components/admin/SettingsPageSkeleton";
import type {
  NotificationSettings,
  NotificationEventKey,
  NotificationChannel,
  NotificationChannelType,
  NotificationTemplateKey,
  NotificationTemplates,
} from "@/lib/types";
import { CHANNEL_TYPES, presetFields, secretKeys } from "@/lib/notification-presets";
import { Toggle } from "@/components/admin/gallery-settings-fields";
import { SaveStatus } from "@/components/admin/SaveStatus";
import { useSettingsAutosave } from "@/hooks/useSettingsAutosave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Send } from "lucide-react";
import { toast } from "sonner";
import { uid } from "@/lib/utils";

const EVENT_KEYS: NotificationEventKey[] = ["comment", "annotation", "collection", "flag", "upload", "download", "view"];
const TEMPLATE_KEYS: NotificationTemplateKey[] = ["title", "comment", "annotation", "collection", "upload", "download", "flag", "view"];

const BLANK_TEMPLATES: NotificationTemplates = {
  title: "", comment: "", annotation: "", collection: "", upload: "", download: "", flag: "", view: "",
};

// Placeholders offered per template field — shown as a hint so admins know what they can interpolate.
const TEMPLATE_PLACEHOLDERS: Record<NotificationTemplateKey, string[]> = {
  title: ["{instance}", "{gallery}"],
  comment: ["{author}", "{preview}", "{gallery}", "{instance}"],
  annotation: ["{author}", "{preview}", "{gallery}", "{instance}"],
  collection: ["{author}", "{name}", "{gallery}", "{instance}"],
  upload: ["{count}", "{gallery}", "{instance}"],
  download: ["{count}", "{photos}", "{gallery}", "{instance}"],
  flag: ["{count}", "{gallery}", "{instance}"],
  view: ["{count}", "{gallery}", "{instance}"],
};

const DEFAULTS: NotificationSettings = {
  enabled: false,
  events: { comment: true, annotation: true, collection: true, flag: true, upload: true, download: true, view: false },
  flush_seconds: 60,
  channels: [],
  include_link: true,
  templates: BLANK_TEMPLATES,
};

function newChannel(type: NotificationChannelType): NotificationChannel {
  return { id: uid(), name: "", type, url: "", params: {}, enabled: true };
}

// Loaded channels may predate the type/params fields (legacy custom URLs) — fill defaults.
function normalize(channels: NotificationChannel[] | undefined): NotificationChannel[] {
  return (channels ?? []).map((c) => ({ ...c, type: c.type ?? "custom", params: c.params ?? {} }));
}

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";

export default function NotificationsSettingsPage() {
  const t = useTranslations("settings.notifications");
  const { save, status } = useSettingsAutosave();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  // Local editing buffer for the whole notifications blob; persists secrets typed before a save.
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [addType, setAddType] = useState<NotificationChannelType>("email");
  const raw = draft ?? settings?.notifications ?? DEFAULTS;
  // Merge default event flags so a legacy stored blob (missing newer keys like `download`) still
  // shows a sensible toggle state instead of an unchecked/undefined one.
  const value: NotificationSettings = {
    ...raw,
    events: { ...DEFAULTS.events, ...raw.events },
    channels: normalize(raw.channels),
    include_link: raw.include_link ?? DEFAULTS.include_link,
    templates: { ...BLANK_TEMPLATES, ...raw.templates },
  };

  // Local edit (no save) — for text fields, committed on blur.
  const set = (patch: Partial<NotificationSettings>) => setDraft({ ...value, ...patch });
  // Apply + persist immediately — for discrete controls (toggles, service select, add/remove).
  // The backend merges masked secrets, so sending the (possibly masked) channels is lossless.
  const apply = (patch: Partial<NotificationSettings>) => {
    const next = { ...value, ...patch };
    setDraft(next);
    save({ notifications: next });
  };
  // Persist the current buffer — used on blur of free-text fields.
  const commit = () => save({ notifications: value });

  const setEvent = (key: NotificationEventKey, on: boolean) =>
    apply({ events: { ...value.events, [key]: on } });
  const setTemplate = (key: NotificationTemplateKey, v: string) =>
    set({ templates: { ...value.templates, [key]: v } });
  const setChannel = (id: string, patch: Partial<NotificationChannel>) =>
    set({ channels: value.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const setParam = (id: string, key: string, v: string) =>
    set({
      channels: value.channels.map((c) =>
        c.id === id ? { ...c, params: { ...c.params, [key]: v } } : c,
      ),
    });
  // Changing the service resets the type-specific config (discrete → save immediately).
  const setType = (id: string, type: NotificationChannelType) =>
    apply({
      channels: value.channels.map((c) =>
        c.id === id ? { ...c, type, url: "", params: {}, secrets_set: undefined } : c,
      ),
    });

  async function testChannel(ch: NotificationChannel) {
    try {
      if (ch.type === "custom") {
        const isMasked = !ch.url || ch.url.includes("••");
        await api.adminSettings.testNotification(isMasked ? { channel_id: ch.id } : { url: ch.url });
      } else {
        // A masked secret means the user is relying on a previously-saved value the browser can't
        // see — resolve the channel server-side by id. Otherwise (fresh/edited, incl. empty optional
        // secrets) send the typed params so it works even before the channel is saved.
        const hasMaskedSecret = secretKeys(ch.type).some((k) => (ch.params[k] ?? "").includes("••"));
        await api.adminSettings.testNotification(
          hasMaskedSecret ? { channel_id: ch.id } : { type: ch.type, params: ch.params },
        );
      }
      toast.success(t("testSent"));
    } catch (err) {
      toast.error((err as Error).message || t("testFailed"));
    }
  }

  if (isLoading || !settings) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <SaveStatus status={status} />
      </div>
      <p className="text-xs text-muted-foreground -mt-3">{t("subtitle")}</p>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-1">
        <Toggle
          label={t("enable")}
          hint={t("enableHint")}
          checked={value.enabled}
          onChange={(on) => apply({ enabled: on })}
        />
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("eventsTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("eventsHint")}</p>
        </div>
        <div className="space-y-1">
          {EVENT_KEYS.map((key) => (
            <Toggle
              key={key}
              label={t(`event_${key}`)}
              hint={t(`event_${key}_hint`)}
              checked={value.events[key]}
              onChange={(on) => setEvent(key, on)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("messageTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("messageHint")}</p>
        </div>
        <Toggle
          label={t("includeLink")}
          hint={t("includeLinkHint")}
          checked={value.include_link}
          onChange={(on) => apply({ include_link: on })}
        />
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">{t("templatesHint")}</p>
          {TEMPLATE_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t(`tmpl_${key}`)}</Label>
              <Input
                value={value.templates[key]}
                onChange={(e) => setTemplate(key, e.target.value)}
                onBlur={commit}
                placeholder={String(t.raw(`tmpl_${key}_default`))}
                className="text-sm"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground/80 font-mono">
                {TEMPLATE_PLACEHOLDERS[key].join("  ")}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t("channelsTitle")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t.rich("channelsHint", {
              a: (chunks) => (
                <a
                  href="https://github.com/caronc/apprise/wiki"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>

        <div className="space-y-3">
          {value.channels.map((ch) => (
            <div key={ch.id} className="rounded-md border border-border bg-background p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  value={ch.name}
                  onChange={(e) => setChannel(ch.id, { name: e.target.value })}
                  onBlur={commit}
                  placeholder={t("channelNamePlaceholder")}
                  className="text-sm"
                />
                <select
                  value={ch.type}
                  onChange={(e) => setType(ch.id, e.target.value as NotificationChannelType)}
                  aria-label={t("serviceLabel")}
                  className={SELECT_CLASS}
                >
                  {CHANNEL_TYPES.map((tp) => (
                    <option key={tp} value={tp}>{t(`type_${tp}`)}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => apply({ channels: value.channels.filter((c) => c.id !== ch.id) })}
                  aria-label={t("removeChannel")}
                >
                  <Trash2 size={16} />
                </Button>
              </div>

              {ch.type === "custom" ? (
                <Input
                  value={ch.url}
                  onChange={(e) => setChannel(ch.id, { url: e.target.value })}
                  onBlur={commit}
                  placeholder={t("channelUrlPlaceholder")}
                  className="text-sm font-mono"
                  spellCheck={false}
                />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {presetFields(ch.type).map((f) => {
                    const stored = ch.secrets_set?.[f.key];
                    return (
                      <div key={f.key} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          {t(`field_${f.key}`)}
                          {f.required && <span className="text-destructive"> *</span>}
                        </Label>
                        <Input
                          type={f.secret ? "password" : f.input === "number" ? "number" : "text"}
                          value={ch.params[f.key] ?? ""}
                          onChange={(e) => setParam(ch.id, f.key, e.target.value)}
                          onBlur={commit}
                          placeholder={f.secret && stored ? "••••••••" : ""}
                          className="text-sm"
                          spellCheck={false}
                          autoComplete="off"
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {ch.type !== "custom" && secretKeys(ch.type).some((k) => ch.secrets_set?.[k]) && (
                <p className="text-[11px] text-muted-foreground">{t("secretKeep")}</p>
              )}

              <div className="flex items-center justify-between">
                <Toggle
                  label={t("channelEnabled")}
                  checked={ch.enabled}
                  onChange={(on) => apply({ channels: value.channels.map((c) => (c.id === ch.id ? { ...c, enabled: on } : c)) })}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => testChannel(ch)}>
                  <Send size={14} className="mr-1.5" />
                  {t("test")}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value as NotificationChannelType)}
            aria-label={t("serviceLabel")}
            className={SELECT_CLASS}
          >
            {CHANNEL_TYPES.map((tp) => (
              <option key={tp} value={tp}>{t(`type_${tp}`)}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => apply({ channels: [...value.channels, newChannel(addType)] })}
          >
            <Plus size={14} className="mr-1.5" />
            {t("addChannel")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-2">
        <Label htmlFor="flush">{t("flushLabel")}</Label>
        <Input
          id="flush"
          type="number"
          min={15}
          max={3600}
          value={value.flush_seconds}
          onChange={(e) => set({ flush_seconds: Number(e.target.value) })}
          onBlur={commit}
          className="text-sm w-32"
        />
        <p className="text-xs text-muted-foreground">{t("flushHint")}</p>
      </section>
    </div>
  );
}
