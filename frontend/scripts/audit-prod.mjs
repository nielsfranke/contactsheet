// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Production npm audit with a justified allowlist.
// Run from frontend/: node scripts/audit-prod.mjs
//
// Why not plain `npm audit --omit=dev --audit-level=high`: some advisories sit in packages Next
// bundles itself, where npm's only proposed "fix" is a major downgrade of Next. Those can't be
// resolved here — only upstream can — so a bare audit leaves the job permanently red, which trains
// everyone to ignore it. This fails on anything NOT in the allowlist below, so a genuinely new
// high/critical advisory still breaks the build loudly.
//
// An allowlist entry is a promise to re-check: each carries why it is not exploitable *here*.
// Stale entries (advisory no longer reported) also fail — so the list can't quietly rot.

import { execSync } from "node:child_process";

// Empty is the goal state: every advisory that was parked here has been fixed upstream. Next 16.3.0
// ships postcss 8.5.23 and sharp 0.35.3, which cleared the four entries that lived here (one sharp /
// libvips, three postcss sourceMappingURL + stringify issues). Add an entry only when an advisory is
// genuinely unfixable from this repo — with the reasoning for why it is not exploitable *here* — and
// drop it again as soon as the upstream fix lands (the staleness check below will insist).
const ALLOWED = [];

const BLOCKING = new Set(["high", "critical"]);

let report;
try {
  // npm audit exits non-zero when it finds anything — that's the normal path here, not an error.
  report = execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  report = e.stdout;
}
if (!report) {
  console.error("✗ npm audit produced no output");
  process.exit(1);
}

const { vulnerabilities = {} } = JSON.parse(report);

const allowedIds = new Set(ALLOWED.map((a) => a.id));
const seenIds = new Set();
const unexpected = [];

for (const vuln of Object.values(vulnerabilities)) {
  if (!BLOCKING.has(vuln.severity)) continue;
  for (const via of vuln.via) {
    if (typeof via === "string") continue; // indirect: reported on its own source package too
    const id = (via.url || "").split("/").pop();
    seenIds.add(id);
    if (!allowedIds.has(id)) {
      unexpected.push(`${vuln.name}: ${via.title} (${via.url})`);
    }
  }
}

const stale = ALLOWED.filter((a) => !seenIds.has(a.id));

for (const a of ALLOWED.filter((a) => seenIds.has(a.id))) {
  console.log(`· allowed ${a.id} (${a.module})`);
}

if (stale.length) {
  console.error("\n✗ Allowlist entries no longer reported — the upstream fix landed, drop them:");
  for (const a of stale) console.error(`   ${a.id} (${a.module})`);
}

if (unexpected.length) {
  console.error("\n✗ New high/critical advisories outside the allowlist:");
  for (const u of unexpected) console.error(`   ${u}`);
}

if (stale.length || unexpected.length) process.exit(1);

console.log(`\n✓ npm audit OK — no unreviewed high/critical advisories in production deps`);
