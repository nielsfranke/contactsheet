// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { redirect } from "next/navigation";

// Admin View was merged into Workspace (alongside the admin theme). Keep the old URL working.
export default function AdminViewSettingsPage() {
  redirect("/admin/settings/workspace");
}
