// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/api";
import type { FooterSettings } from "@/lib/types";
import { FOOTER_ICON_META, SOCIAL_META, socialHandle } from "@/components/gallery/GalleryFooter";
import { Toggle } from "@/components/admin/gallery-settings-fields";
import { SaveStatus } from "@/components/admin/SaveStatus";
import { useSettingsAutosave } from "@/hooks/useSettingsAutosave";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GripVertical } from "lucide-react";

type FooterField = keyof FooterSettings;

// Plain (non-reorderable) text fields shown above the contact/social rows.
// labelKey/placeholderKey resolve against the `settings.footer` catalog at render.
const TOP_FIELDS: { key: FooterField; labelKey: string; placeholderKey: string }[] = [
  { key: "business_name", labelKey: "businessName", placeholderKey: "businessNamePlaceholder" },
  { key: "website_url", labelKey: "website", placeholderKey: "websitePlaceholder" },
];

// Per-row placeholder + input type for the contact/social rows (socials show just the handle).
const ROW_PLACEHOLDER: Record<string, string> = {
  email: "hello@mywebsite.com",
  phone: "+1 555 123 4567",
  instagram: "yourhandle",
  facebook: "yourpage",
  x: "yourhandle",
  tiktok: "yourhandle",
  youtube: "yourchannel",
  linkedin: "you",
};
const ROW_TYPE: Record<string, string> = { email: "email", phone: "tel" };

const DEFAULT_ORDER = FOOTER_ICON_META.map((m) => m.key);
const ICONS: Record<string, React.ReactNode> = Object.fromEntries(
  FOOTER_ICON_META.map((m) => [m.key, m.node]),
);
const LABEL_TEXT: Record<string, string> = Object.fromEntries(
  FOOTER_ICON_META.map((m) => [m.key, m.label]),
);

/** Merge a saved order with the default so all keys are present exactly once. */
function fullOrder(saved: string[] | undefined): string[] {
  const merged = [...(saved ?? []), ...DEFAULT_ORDER];
  return merged.filter((k, i) => merged.indexOf(k) === i && DEFAULT_ORDER.includes(k));
}

/** One draggable contact/social row: drag handle + icon + inline handle input. */
function SortableRow({
  id,
  value,
  onChange,
  onCommit,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const t = useTranslations("settings.footer");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const prefix = SOCIAL_META[id]?.prefix;
  // Socials display the bare handle (legacy full URLs are stripped back to a handle).
  const display = SOCIAL_META[id] ? socialHandle(id, value) : value;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 transition-shadow focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 ${
        isDragging ? "opacity-60 shadow-sm" : ""
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={t("reorder", { label: LABEL_TEXT[id] })}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <span className="flex w-5 shrink-0 justify-center text-foreground" aria-hidden="true">
        {ICONS[id]}
      </span>
      <div className="flex min-w-0 flex-1 items-center text-sm">
        {prefix && <span className="shrink-0 text-muted-foreground">{prefix}</span>}
        <input
          type={ROW_TYPE[id] ?? "text"}
          value={display}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          placeholder={ROW_PLACEHOLDER[id]}
          aria-label={LABEL_TEXT[id]}
          className="min-w-0 flex-1 bg-transparent px-1 text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

export default function FooterSettingsPage() {
  const t = useTranslations("settings.footer");
  const tc = useTranslations("common");
  const { save, status } = useSettingsAutosave();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { data: settings, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.adminSettings.get(),
  });

  // Editing buffers for the content; the master toggle saves instantly straight from `settings`.
  const [form, setForm] = useState<FooterSettings | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);

  const effForm = form ?? settings?.footer ?? {};
  const effOrder = order ?? fullOrder(settings?.footer?.icon_order);

  const setField = (key: FooterField, value: string) => setForm({ ...effForm, [key]: value });

  // Persist the whole footer content blob (blank fields stripped server-side).
  const saveFooter = (nextForm: FooterSettings = effForm, nextOrder: string[] = effOrder) =>
    save({ footer: { ...nextForm, icon_order: nextOrder } });

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const from = effOrder.indexOf(active.id as string);
      const to = effOrder.indexOf(over.id as string);
      const next = arrayMove(effOrder, from, to);
      setOrder(next);
      saveFooter(effForm, next);
    }
  }

  if (isLoading || !settings) {
    return <div className="p-6 text-muted-foreground">{tc("loading")}</div>;
  }

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <SaveStatus status={status} />
      </div>
      <p className="text-xs text-muted-foreground -mt-3">
        {t.rich("subtitle", { b: (chunks) => <span className="text-foreground">{chunks}</span> })}
      </p>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-1">
        <Toggle
          label={t("showFooter")}
          hint={t("showFooterHint")}
          checked={settings.footer_enabled}
          onChange={(on) => save({ footer_enabled: on })}
        />
      </section>

      <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
        {TOP_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label>{t(f.labelKey)}</Label>
            <Input
              value={(effForm[f.key] as string | undefined) ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              onBlur={() => saveFooter()}
              placeholder={t(f.placeholderKey)}
              className="text-sm"
            />
          </div>
        ))}

        <div className="pt-1">
          <h2 className="text-sm font-medium text-foreground">{t("contactSocial")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("contactSocialHint")}
          </p>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={effOrder} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {effOrder.map((key) => (
                <SortableRow
                  key={key}
                  id={key}
                  value={(effForm[key as FooterField] as string | undefined) ?? ""}
                  onChange={(v) => setField(key as FooterField, v)}
                  onCommit={() => saveFooter()}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </div>
  );
}
