// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  BrightnessType,
  CornersType,
  FontType,
  LayoutType,
  SizeType,
  TitlePositionType,
  WatermarkMode,
  WatermarkSettings,
  WatermarkSize,
} from "@/lib/types";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Columns3, LayoutGrid, List, Sparkles } from "lucide-react";
import { FontPicker } from "./FontPicker";
import { WatermarkUpload } from "./WatermarkUpload";

/** Small segmented control used throughout the settings forms. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.icon ? (
            <span className="flex flex-col items-center gap-1">
              {o.icon}
              <span className="text-xs">{o.label}</span>
            </span>
          ) : (
            o.label
          )}
        </button>
      ))}
    </div>
  );
}

/** Small uppercase section header inside a settings tab. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/** Labelled row wrapper. */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <Label className="font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="max-w-full flex-shrink-0">{children}</div>
    </div>
  );
}

/** Switch toggle row. `comingSoon` renders disabled with a hint. `indent` nests it visually. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
  comingSoon = false,
  disabled = false,
  indent = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  comingSoon?: boolean;
  /** Greyed out + non-interactive without the "Coming soon" badge (e.g. an unmet dependency). */
  disabled?: boolean;
  indent?: boolean;
}) {
  const t = useTranslations("settings.fields");
  const inactive = comingSoon || disabled;
  return (
    <label
      className={`flex items-center justify-between gap-4 py-2.5 ${
        indent ? "pl-4" : ""
      } ${inactive ? "opacity-50" : "cursor-pointer"}`}
    >
      <div className="min-w-0">
        <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
          {label}
          {comingSoon && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-muted-foreground border border-border rounded px-1 py-0.5">
              <Sparkles size={9} /> {t("comingSoon")}
            </span>
          )}
        </span>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch
        className="flex-shrink-0"
        checked={checked}
        disabled={inactive}
        onCheckedChange={(v) => onChange?.(v)}
      />
    </label>
  );
}

export const SIZE_OPTS: { value: SizeType; label: string }[] = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

// Shared between GallerySettingsModal (per-gallery) and PresetEditorModal (instance defaults).

// --- Look: grid + lightbox appearance. Applies in BOTH modes. ---
export interface LookValues {
  layout: LayoutType;
  preview_size: SizeType;
  preview_spacing: SizeType;
  preview_corners: CornersType;
  bg_brightness: BrightnessType;
  show_filename: boolean;
  show_filename_lightbox: boolean;
  show_exif: boolean;
  show_iptc: boolean;
}

export function LookFields({
  value,
  onChange,
}: {
  value: LookValues;
  onChange: (patch: Partial<LookValues>) => void;
}) {
  const t = useTranslations("settings.fields");
  return (
    <>
      <Row label={t("layout")} hint={t("layoutHint")}>
        <Segmented<LayoutType>
          value={value.layout}
          onChange={(v) => onChange({ layout: v })}
          options={[
            { value: "grid", label: t("grid"), icon: <LayoutGrid size={18} /> },
            { value: "masonry", label: t("masonry"), icon: <Columns3 size={18} /> },
            { value: "list", label: t("list"), icon: <List size={18} /> },
          ]}
        />
      </Row>

      <SectionLabel>{t("imagePreviews")}</SectionLabel>
      <Row label={t("previewSize")} hint={t("previewSizeHint")}>
        <Segmented<SizeType>
          value={value.preview_size}
          onChange={(v) => onChange({ preview_size: v })}
          options={SIZE_OPTS}
        />
      </Row>
      <Row label={t("previewSpacing")} hint={t("previewSpacingHint")}>
        <Segmented<SizeType>
          value={value.preview_spacing}
          onChange={(v) => onChange({ preview_spacing: v })}
          options={SIZE_OPTS}
        />
      </Row>
      <Row label={t("corners")}>
        <Segmented<CornersType>
          value={value.preview_corners}
          onChange={(v) => onChange({ preview_corners: v })}
          options={[
            { value: "round", label: t("round") },
            { value: "square", label: t("square") },
          ]}
        />
      </Row>

      <SectionLabel>{t("background")}</SectionLabel>
      <Row label={t("brightness")} hint={t("brightnessHint")}>
        <Segmented<BrightnessType>
          value={value.bg_brightness}
          onChange={(v) => onChange({ bg_brightness: v })}
          options={[
            { value: "dark", label: t("dark") },
            { value: "bright", label: t("bright") },
          ]}
        />
      </Row>

      <SectionLabel>{t("showFileInfo")}</SectionLabel>
      <Toggle
        label={t("filename")}
        hint={t("filenameHint")}
        checked={value.show_filename}
        onChange={(v) => onChange({ show_filename: v })}
      />
      <Toggle
        label={t("filenameLightbox")}
        hint={t("filenameLightboxHint")}
        checked={value.show_filename_lightbox}
        onChange={(v) => onChange({ show_filename_lightbox: v })}
      />
      <Toggle
        label={t("exif")}
        hint={t("exifHint")}
        checked={value.show_exif}
        onChange={(v) => onChange({ show_exif: v })}
      />
      <Toggle
        label={t("iptc")}
        hint={t("iptcHint")}
        checked={value.show_iptc}
        onChange={(v) => onChange({ show_iptc: v })}
      />
    </>
  );
}

// --- Opener: the full-bleed cover heading. SHOWCASE mode only. ---
export interface OpenerValues {
  opener_font: FontType;
  opener_font_size: SizeType;
  opener_title_position: TitlePositionType;
}

export function OpenerFields({
  value,
  onChange,
}: {
  value: OpenerValues;
  onChange: (patch: Partial<OpenerValues>) => void;
}) {
  const t = useTranslations("settings.fields");
  return (
    <>
      <Row label={t("headingFont")}>
        <FontPicker value={value.opener_font} onChange={(v) => onChange({ opener_font: v })} />
      </Row>
      <Row label={t("headingSize")}>
        <Segmented<SizeType>
          value={value.opener_font_size}
          onChange={(v) => onChange({ opener_font_size: v })}
          options={SIZE_OPTS}
        />
      </Row>
      <Row label={t("titlePosition")}>
        <PositionGrid<TitlePositionType>
          value={value.opener_title_position}
          onChange={(v) => onChange({ opener_title_position: v })}
        />
      </Row>
    </>
  );
}

// --- Review: client feedback interactions. REVIEW mode only. ---
export interface ReviewValues {
  color_flags_enabled: boolean;
  likes_enabled: boolean;
  enable_team_voting: boolean;
  comments_enabled: boolean;
  annotations_enabled: boolean;
  sets_enabled: boolean;
}

export function ReviewFields({
  value,
  onChange,
}: {
  value: ReviewValues;
  onChange: (patch: Partial<ReviewValues>) => void;
}) {
  const t = useTranslations("settings.fields");
  return (
    <>
      <SectionLabel>{t("interactions")}</SectionLabel>
      <Toggle
        label={t("colorFlags")}
        hint={t("colorFlagsHint")}
        checked={value.color_flags_enabled}
        onChange={(v) => onChange({ color_flags_enabled: v })}
      />
      <Toggle
        label={t("teamVoting")}
        hint={t("teamVotingHint")}
        checked={value.color_flags_enabled && value.enable_team_voting}
        onChange={(v) => onChange({ enable_team_voting: v })}
        disabled={!value.color_flags_enabled}
        indent
      />
      <Toggle
        label={t("likes")}
        hint={t("likesHint")}
        checked={value.likes_enabled}
        onChange={(v) => onChange({ likes_enabled: v })}
      />
      <Toggle
        label={t("comments")}
        hint={t("commentsHint")}
        checked={value.comments_enabled}
        onChange={(v) => onChange({ comments_enabled: v })}
      />
      <Toggle
        label={t("annotations")}
        hint={t("annotationsHint")}
        checked={value.comments_enabled && value.annotations_enabled}
        onChange={(v) => onChange({ annotations_enabled: v })}
        disabled={!value.comments_enabled}
        indent
      />

      <SectionLabel>{t("collections")}</SectionLabel>
      <Toggle
        label={t("collectionsToggle")}
        hint={t("collectionsHint")}
        checked={value.sets_enabled}
        onChange={(v) => onChange({ sets_enabled: v })}
      />
    </>
  );
}

const WM_SIZE_OPTS: { value: WatermarkSize; label: string }[] = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

// The nine anchor keys, shared by the watermark position and the opener title position
// (their value unions are identical). The `positions.*` i18n group labels them.
const ANCHOR_POSITIONS = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;

/** 3×3 grid picker for a nine-way anchor (watermark or opener title position). */
function PositionGrid<T extends string>({
  value,
  onChange,
}: {
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTranslations("settings.fields");
  return (
    <div className="inline-grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
      {ANCHOR_POSITIONS.map((pos) => (
        <button
          key={pos}
          type="button"
          aria-label={t(`positions.${pos}`)}
          title={t(`positions.${pos}`)}
          onClick={() => onChange(pos as T)}
          className={`h-6 w-6 rounded flex items-center justify-center transition-colors ${
            value === pos ? "bg-primary" : "bg-background hover:bg-accent"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${value === pos ? "bg-primary-foreground" : "bg-muted-foreground/50"}`} />
        </button>
      ))}
    </div>
  );
}

/** Watermark configuration (Security tab). Image or text mode, opacity/size/position. */
export function WatermarkFields({
  galleryId,
  value,
  onChange,
}: {
  galleryId: string;
  value: WatermarkSettings;
  onChange: (patch: Partial<WatermarkSettings>) => void;
}) {
  const t = useTranslations("settings.fields");
  return (
    <div className="space-y-1">
      <Toggle
        label={t("watermark")}
        hint={t("watermarkHint")}
        checked={value.enabled}
        onChange={(v) => onChange({ enabled: v })}
      />

      {value.enabled && (
        <div className="space-y-1 pl-4 border-l border-border">
          <Row label={t("type")}>
            <Segmented<WatermarkMode>
              value={value.mode}
              onChange={(v) => onChange({ mode: v })}
              options={[
                { value: "image", label: t("image") },
                { value: "text", label: t("text") },
              ]}
            />
          </Row>

          {value.mode === "image" ? (
            <div className="py-2.5">
              <WatermarkUpload
                galleryId={galleryId}
                hasWatermark={!!value.filename}
                onUploaded={(filename) => onChange({ filename })}
              />
            </div>
          ) : (
            <>
              <div className="space-y-1 py-2.5">
                <Label className="font-medium">{t("textLabel")}</Label>
                <Input
                  value={value.text ?? ""}
                  maxLength={120}
                  placeholder={t("textPlaceholder")}
                  onChange={(e) => onChange({ text: e.target.value })}
                />
              </div>
              <Row label={t("color")}>
                <input
                  type="color"
                  value={value.color}
                  onChange={(e) => onChange({ color: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border border-input bg-background"
                />
              </Row>
            </>
          )}

          <Row label={t("opacity")} hint={`${value.opacity}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={value.opacity}
              onChange={(e) => onChange({ opacity: Number(e.target.value) })}
              className="w-36 accent-[var(--primary)]"
            />
          </Row>
          <Row label={t("size")}>
            <Segmented<WatermarkSize>
              value={value.size}
              onChange={(v) => onChange({ size: v })}
              options={WM_SIZE_OPTS}
            />
          </Row>
          <Row label={t("position")}>
            <PositionGrid value={value.position} onChange={(v) => onChange({ position: v })} />
          </Row>
        </div>
      )}
    </div>
  );
}
