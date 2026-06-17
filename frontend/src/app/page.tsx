// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/admin/galleries");
}
