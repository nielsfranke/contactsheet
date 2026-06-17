// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Rendering-only mirror of the backend preset registry (app/notifications/presets.py). The backend
// stays the single source of truth for building and validating Apprise URLs — this only drives the
// settings form (which fields to show, which are secret/required, and the input type). Keep the
// field keys in sync with presets.py.

import type { NotificationChannelType } from "./types";

export interface PresetField {
  key: string;
  secret?: boolean;
  required?: boolean;
  /** HTML input type; defaults to "text". Secret fields render as password. */
  input?: "text" | "number";
}

export interface ChannelPreset {
  type: NotificationChannelType;
  fields: PresetField[];
}

// Order = the "Add channel" service picker order. "custom" is handled separately (raw URL input).
export const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    type: "email",
    fields: [
      { key: "host", required: true },
      { key: "port", input: "number" },
      { key: "user" },
      { key: "password", secret: true },
      { key: "from" },
      { key: "to", required: true },
    ],
  },
  {
    type: "pushover",
    fields: [
      { key: "user_key", secret: true, required: true },
      { key: "app_token", secret: true, required: true },
    ],
  },
  {
    type: "ntfy",
    fields: [
      { key: "topic", required: true },
      { key: "server" },
      { key: "token", secret: true },
    ],
  },
  {
    type: "discord",
    fields: [
      { key: "webhook_id", secret: true, required: true },
      { key: "webhook_token", secret: true, required: true },
    ],
  },
  {
    type: "telegram",
    fields: [
      { key: "bot_token", secret: true, required: true },
      { key: "chat_id", required: true },
    ],
  },
  {
    type: "slack",
    fields: [
      { key: "token_a", secret: true, required: true },
      { key: "token_b", secret: true, required: true },
      { key: "token_c", secret: true, required: true },
    ],
  },
];

// All selectable types in picker order, with custom last.
export const CHANNEL_TYPES: NotificationChannelType[] = [
  ...CHANNEL_PRESETS.map((p) => p.type),
  "custom",
];

export function presetFields(type: NotificationChannelType): PresetField[] {
  return CHANNEL_PRESETS.find((p) => p.type === type)?.fields ?? [];
}

export function secretKeys(type: NotificationChannelType): string[] {
  return presetFields(type).filter((f) => f.secret).map((f) => f.key);
}
