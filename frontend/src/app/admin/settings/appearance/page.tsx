// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { redirect } from "next/navigation";

// Appearance was split: theme moved to Workspace, accent + lightbox backdrop moved to
// Branding / Gallery defaults. Keep the old URL working.
export default function AppearanceSettingsPage() {
  redirect("/admin/settings/workspace");
}
