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

const ALLOWED = [
  {
    id: "GHSA-f88m-g3jw-g9cj",
    module: "sharp",
    why:
      "sharp/libvips CVEs are reachable only through Next's Image Optimization API, which this app " +
      "disables outright (`images: { unoptimized: true }` in next.config.ts) — sharp is never " +
      "invoked at runtime. Photo processing is Pillow in the backend, not sharp. Pinned by Next's " +
      "own dependency range; clears when Next ships sharp >= 0.35.0.",
  },
  {
    id: "GHSA-qx2v-qp2m-jg93",
    module: "postcss",
    why:
      "postcss runs at build time over this repo's own Tailwind sources. All three advisories need " +
      "attacker-controlled CSS (stringify XSS / sourceMappingURL file read) — no user input ever " +
      "reaches it. Bundled inside next/node_modules; clears when Next ships postcss > 8.5.17.",
  },
  { id: "GHSA-6g55-p6wh-862q", module: "postcss", why: "Same postcss instance and reasoning as GHSA-qx2v-qp2m-jg93." },
  { id: "GHSA-r28c-9q8g-f849", module: "postcss", why: "Same postcss instance and reasoning as GHSA-qx2v-qp2m-jg93." },
];

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
