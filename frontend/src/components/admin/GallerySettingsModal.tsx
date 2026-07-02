// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MODE_LABELS, DEFAULT_WATERMARK, type GalleryResponse, type ModeType, type WatermarkSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LookFields,
  type LookValues,
  OpenerFields,
  type OpenerValues,
  ReviewFields,
  type ReviewValues,
  Toggle,
  WatermarkFields,
} from "./gallery-settings-fields";
import { HeaderImageUpload } from "./HeaderImageUpload";
import { SaveStatus } from "./SaveStatus";
import { useGallerySettingsAutosave } from "@/hooks/useGallerySettingsAutosave";
import {
  ImageIcon,
  MessagesSquare,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";

export type SettingsTab = "general" | "look" | "review" | "security";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gallery: GalleryResponse;
  initialTab?: SettingsTab;
}

export function GallerySettingsModal({
  open,
  onOpenChange,
  gallery,
  initialTab,
}: Props) {
  const { save, status } = useGallerySettingsAutosave(gallery.id);
  const t = useTranslations("settings.gallery");
  const tNotif = useTranslations("settings.notifications");
  const tc = useTranslations("common");
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "general");

  // Jump to the requested tab each time the modal transitions to open (no effect needed).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && initialTab) setTab(initialTab);
  }

  // General / identity
  const [name, setName] = useState(gallery.name);
  const [headline, setHeadline] = useState(gallery.headline ?? "");
  const [mode, setMode] = useState<ModeType>(gallery.mode);
  const [downloads, setDownloads] = useState(gallery.downloads_enabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(gallery.notifications_enabled);

  // Look — grid + lightbox appearance (both modes)
  const [look, setLook] = useState<LookValues>({
    layout: gallery.layout,
    preview_size: gallery.preview_size,
    preview_spacing: gallery.preview_spacing,
    preview_corners: gallery.preview_corners,
    bg_brightness: gallery.bg_brightness,
    show_filename: gallery.show_filename,
    show_filename_lightbox: gallery.show_filename_lightbox,
    show_exif: gallery.show_exif,
    show_iptc: gallery.show_iptc,
  });

  // Opener — full-bleed cover heading (Showcase only)
  const [opener, setOpener] = useState<OpenerValues>({
    opener_font: gallery.opener_font,
    opener_font_size: gallery.opener_font_size,
    opener_title_position: gallery.opener_title_position,
    opener_scrim: gallery.opener_scrim,
    opener_title_shadow: gallery.opener_title_shadow,
  });

  // Review — client feedback interactions (Review only)
  const [review, setReview] = useState<ReviewValues>({
    color_flags_enabled: gallery.color_flags_enabled,
    likes_enabled: gallery.likes_enabled,
    enable_team_voting: gallery.enable_team_voting,
    comments_enabled: gallery.comments_enabled,
    annotations_enabled: gallery.annotations_enabled,
    sets_enabled: gallery.sets_enabled,
  });

  const [clientUpload, setClientUpload] = useState(gallery.client_upload_enabled);
  const [clientUploadModeration, setClientUploadModeration] = useState(gallery.client_upload_moderation);

  // Security
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState(gallery.expires_at ? gallery.expires_at.slice(0, 10) : "");
  const [hideParentNav, setHideParentNav] = useState(gallery.hide_parent_nav);

  const hasChildren = gallery.children.length > 0;
  const [wmSettings, setWmSettings] = useState<WatermarkSettings>(() => {
    try {
      const parsed = gallery.watermark_settings ? JSON.parse(gallery.watermark_settings) : {};
      return { ...DEFAULT_WATERMARK, ...parsed };
    } catch {
      return { ...DEFAULT_WATERMARK };
    }
  });

  // --- autosave wiring -----------------------------------------------------
  // Discrete controls update local state (instant UI) and fire `save` with just their delta.
  // Text/date fields commit on blur, only when the value actually changed and is valid.

  const expiryToIso = (d: string) => (d ? new Date(d).toISOString() : null);

  function commitName() {
    const v = name.trim();
    if (v && v !== gallery.name) save({ name: v });
  }
  function commitHeadline() {
    const v = headline.trim();
    if (v !== (gallery.headline ?? "")) save({ headline: v || null });
  }
  function commitExpiry() {
    if (expiresAt !== (gallery.expires_at ? gallery.expires_at.slice(0, 10) : "")) {
      save({ expires_at: expiryToIso(expiresAt) });
    }
  }

  function pickMode(next: ModeType) {
    setMode(next);
    save({ mode: next });
    // Leaving Review mode hides the Review tab — fall back so the body isn't blank.
    if (next === "presentation" && tab === "review") setTab("look");
  }

  function patchLook(patch: Partial<LookValues>) {
    setLook((s) => ({ ...s, ...patch }));
    save(patch);
  }
  function patchOpener(patch: Partial<OpenerValues>) {
    setOpener((s) => ({ ...s, ...patch }));
    save(patch);
  }
  function patchReview(patch: Partial<ReviewValues>) {
    setReview((s) => ({ ...s, ...patch }));
    save(patch);
  }
  function patchWatermark(patch: Partial<WatermarkSettings>) {
    const next = { ...wmSettings, ...patch };
    setWmSettings(next);
    save({ watermark_settings: JSON.stringify(next) });
  }

  function setPasswordNow() {
    if (password) {
      save({ password });
      setPassword("");
    }
  }

  // Explicit cascade: re-apply the current look & behaviour to direct children in one PATCH (the
  // backend filters to its cascade-eligible field set). Never part of an autosave patch.
  function applyToSubgalleries() {
    save({
      mode,
      ...look,
      ...opener,
      ...review,
      downloads_enabled: downloads,
      client_upload_enabled: clientUpload,
      client_upload_moderation: clientUploadModeration,
      hide_parent_nav: hideParentNav,
      expires_at: expiryToIso(expiresAt),
      apply_to_subgalleries: true,
    });
  }

  const MODE_CARDS: { value: ModeType; label: string; icon: typeof Zap; hint: string }[] = [
    { value: "collaboration", label: MODE_LABELS.collaboration, icon: Zap, hint: t("collaborationHint") },
    { value: "presentation", label: MODE_LABELS.presentation, icon: ImageIcon, hint: t("presentationHint") },
  ];

  // The Review tab only applies in Review mode, so it's hidden for Showcase galleries.
  const tabs: { value: SettingsTab; label: string; icon: typeof Zap }[] = [
    { value: "general", label: t("tabGeneral"), icon: SlidersHorizontal },
    { value: "look", label: t("tabLook"), icon: ImageIcon },
    ...(mode === "collaboration"
      ? [{ value: "review" as const, label: MODE_LABELS.collaboration, icon: MessagesSquare }]
      : []),
    { value: "security", label: t("tabSecurity"), icon: Shield },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t.rich("description", {
              link: (chunks) => (
                <Link href="/admin/settings/gallery-defaults" onClick={() => onOpenChange(false)}>
                  {chunks}
                </Link>
              ),
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Start client view in: hero mode selector */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            {t("startClientView")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MODE_CARDS.map((m) => {
              const active = mode === m.value;
              const Icon = m.icon;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => pickMode(m.value)}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  <Icon
                    size={20}
                    className={active ? "text-primary" : "text-muted-foreground"}
                  />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${active ? "text-foreground" : "text-foreground"}`}>
                      {m.label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{m.hint}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="max-h-[55vh] overflow-y-auto pr-1">
          {tab === "general" && (
            <div className="divide-y divide-border/60">
              <div className="space-y-1 py-2.5">
                <Label>
                  {t("nameLabel")} <span className="text-muted-foreground font-normal">{t("nameHintParen")}</span>
                </Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitName}
                  required
                />
              </div>
              <div className="space-y-1 py-2.5">
                <Label>
                  {t("subtitleLabel")} <span className="text-muted-foreground font-normal">{t("optional")}</span>
                </Label>
                <Input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  onBlur={commitHeadline}
                  placeholder={t("subtitlePlaceholder")}
                />
              </div>
              <Toggle
                label={t("downloadsLabel")}
                hint={t("downloadsHint")}
                checked={downloads}
                onChange={(v) => { setDownloads(v); save({ downloads_enabled: v }); }}
              />
              <Toggle
                label={t("clientUploadLabel")}
                hint={t("clientUploadHint")}
                checked={clientUpload}
                onChange={(v) => { setClientUpload(v); save({ client_upload_enabled: v }); }}
              />
              {clientUpload && (
                <div className="pl-4 border-l-2 border-border/60">
                  <Toggle
                    label={t("clientUploadModerationLabel")}
                    hint={t("clientUploadModerationHint")}
                    checked={clientUploadModeration}
                    onChange={(v) => { setClientUploadModeration(v); save({ client_upload_moderation: v }); }}
                  />
                </div>
              )}
              <Toggle
                label={tNotif("galleryToggle")}
                hint={tNotif("galleryToggleHint")}
                checked={notificationsEnabled}
                onChange={(v) => { setNotificationsEnabled(v); save({ notifications_enabled: v }); }}
              />
            </div>
          )}

          {tab === "look" && (
            <div className="divide-y divide-border/60">
              {/* Showcase-only opener (the full-bleed cover); hidden in Review mode. */}
              {mode === "presentation" && (
                <div className="space-y-2 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles size={13} /> {t("openerIntro", { mode: MODE_LABELS.presentation })}
                  </p>
                  <Label className="font-medium">{t("openerHeaderImage")}</Label>
                  <HeaderImageUpload galleryId={gallery.id} headerImageUrl={gallery.header_image_url} />
                  <OpenerFields value={opener} onChange={patchOpener} />
                </div>
              )}
              <div className="pb-1">
                <LookFields value={look} onChange={patchLook} />
              </div>
            </div>
          )}

          {tab === "review" && mode === "collaboration" && (
            <div className="divide-y divide-border/60">
              <p className="flex items-center gap-1.5 py-2.5 text-xs text-muted-foreground">
                <MessagesSquare size={13} /> {t("reviewIntro", { mode: MODE_LABELS.collaboration })}
              </p>
              <div className="pb-1">
                <ReviewFields value={review} onChange={patchReview} />
              </div>
            </div>
          )}

          {tab === "security" && (
            <div className="divide-y divide-border/60">
              <div className="space-y-1 py-2.5">
                <Label>{t("password")}</Label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={gallery.has_password ? t("passwordKeep") : t("passwordNone")}
                    autoComplete="new-password"
                  />
                  <Button size="sm" variant="outline" onClick={setPasswordNow} disabled={!password}>
                    {t("passwordSet")}
                  </Button>
                </div>
              </div>
              {(gallery.parent_id || hasChildren) && (
                <Toggle
                  label={t("standaloneLabel")}
                  hint={gallery.parent_id ? t("standaloneHintChild") : t("standaloneHintParent")}
                  checked={hideParentNav}
                  onChange={(v) => { setHideParentNav(v); save({ hide_parent_nav: v }); }}
                />
              )}
              <div className="space-y-1 py-2.5">
                <Label>
                  {t("expiresLabel")} <span className="text-muted-foreground font-normal">{t("optional")}</span>
                </Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  onBlur={commitExpiry}
                />
                <p className="text-xs text-muted-foreground">{t("expiresHint")}</p>
              </div>
              <WatermarkFields
                galleryId={gallery.id}
                value={wmSettings}
                onChange={patchWatermark}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
          {hasChildren ? (
            <Button variant="outline" size="sm" onClick={applyToSubgalleries}>
              {t("applyToSub")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <SaveStatus status={status} />
            <Button size="sm" onClick={() => onOpenChange(false)}>
              {tc("close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
