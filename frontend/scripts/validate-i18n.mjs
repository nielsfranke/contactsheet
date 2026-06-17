// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// i18n catalog validation: ICU parse + en↔de parity + arg consistency + key-resolution.
// Run from frontend/ (needs node_modules): node scripts/validate-i18n.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const MESSAGES = "messages";
const SRC = "src";
let errors = 0;
const fail = (m) => { console.error("✗ " + m); errors++; };

// ---- load catalogs ----------------------------------------------------------
const en = JSON.parse(readFileSync(join(MESSAGES, "en.json"), "utf8"));
const de = JSON.parse(readFileSync(join(MESSAGES, "de.json"), "utf8"));

// flatten nested object → { "a.b.c": "msg" }
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const flatEn = flatten(en);
const flatDe = flatten(de);

// ---- 1. ICU parse + collect args -------------------------------------------
function argsOf(ast, acc = new Set()) {
  for (const el of ast) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date ||
        el.type === TYPE.time || el.type === TYPE.select || el.type === TYPE.plural ||
        el.type === TYPE.pound || el.type === TYPE.tag) {
      if (el.value && el.type !== TYPE.pound) acc.add(el.value);
    }
    if (el.options) for (const opt of Object.values(el.options)) argsOf(opt.value, acc);
    if (el.children) argsOf(el.children, acc);
  }
  return acc;
}
function checkParse(flat, locale) {
  const args = {};
  for (const [key, msg] of Object.entries(flat)) {
    try {
      args[key] = argsOf(parse(msg));
    } catch (e) {
      fail(`[${locale}] ICU parse error in "${key}": ${e.message}`);
    }
  }
  return args;
}
const enArgs = checkParse(flatEn, "en");
const deArgs = checkParse(flatDe, "de");

// ---- 2. parity --------------------------------------------------------------
const enKeys = new Set(Object.keys(flatEn));
const deKeys = new Set(Object.keys(flatDe));
for (const k of enKeys) if (!deKeys.has(k)) fail(`missing in de.json: "${k}"`);
for (const k of deKeys) if (!enKeys.has(k)) fail(`extra in de.json (not in en): "${k}"`);

// ---- 3. arg consistency -----------------------------------------------------
for (const k of enKeys) {
  if (!deKeys.has(k)) continue;
  const a = enArgs[k] ?? new Set();
  const b = deArgs[k] ?? new Set();
  const missing = [...a].filter((x) => !b.has(x));
  const extra = [...b].filter((x) => !a.has(x));
  if (missing.length || extra.length) {
    fail(`arg mismatch "${k}": en=[${[...a]}] de=[${[...b]}]`);
  }
}

// ---- 4. key-resolution: every t("key") used in code resolves in en.json -----
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(p).isDirectory()) walk(p, files);
    else if ([".ts", ".tsx"].includes(extname(p))) files.push(p);
  }
  return files;
}
// match `name(...)` translation calls; we resolve the literal-first-arg ones.
for (const file of walk(SRC)) {
  const code = readFileSync(file, "utf8");
  // Collect translator-variable → namespace bindings: `const t = useTranslations("ns")`.
  const binders = [];
  for (const m of [...code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*["'`]([\w.]*)["'`]\s*\)/g)]) {
    binders.push({ name: m[1], ns: m[2] });
  }
  for (const m of [...code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+getTranslations\(\s*["'`]([\w.]*)["'`]\s*\)/g)]) {
    binders.push({ name: m[1], ns: m[2] });
  }
  for (const { name, ns } of binders) {
    // Match `name("literal"` and `name.has("literal"` and `name.rich("literal"`.
    const re = new RegExp(`\\b${name}(?:\\.(?:rich|markup|has|raw))?\\(\\s*["'\`]([\\w.]+)["'\`]`, "g");
    for (const mm of [...code.matchAll(re)]) {
      const key = ns ? `${ns}.${mm[1]}` : mm[1];
      if (!(key in flatEn)) {
        fail(`unresolved key "${key}" (${name} in ${file})`);
      }
    }
  }
}

if (errors === 0) {
  console.log(`✓ i18n OK — ${enKeys.size} keys/locale, parity exact, ICU + args + key-resolution clean`);
  process.exit(0);
} else {
  console.error(`\n${errors} problem(s) found`);
  process.exit(1);
}
