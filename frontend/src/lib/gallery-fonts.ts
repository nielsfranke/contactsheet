// SPDX-FileCopyrightText: 2026 Niels Franke
// SPDX-License-Identifier: AGPL-3.0-or-later

// Gallery opener font registry — the single source of rendering truth for the per-gallery
// presentation heading font (see docs/architecture/gallery-opener-fonts.md).
//
// All fonts are self-hosted via next/font: Google families through next/font/google, and the
// non-Google accessibility fonts (OpenDyslexic, DejaVu Sans/Mono, Atkinson Hyperlegible Mono)
// from vendored woff2 in src/fonts/. Every instance carries `preload: false` so only the font a
// gallery actually uses is fetched by the browser; the CSS variables are defined globally on
// <html> (layout.tsx) but cost nothing until referenced.
//
// The set of `key`s here must stay in sync with the backend `FontType` literal in
// backend/app/schemas/gallery.py (validation gate). Legacy keys "sans"/"serif"/"mono" are not in
// this registry — they're handled as aliases in resolveOpenerFont() for backward compatibility.

import {
  Inter,
  Source_Sans_3,
  Manrope,
  Signika,
  Merriweather_Sans,
  Montserrat,
  Merriweather,
  Lora,
  Libre_Baskerville,
  Bebas_Neue,
  Abril_Fatface,
  Poiret_One,
  Amatic_SC,
  Oleo_Script,
  Pacifico,
  Pinyon_Script,
  Dancing_Script,
  JetBrains_Mono,
  Atkinson_Hyperlegible_Next,
} from "next/font/google";
import localFont from "next/font/local";

// NOTE: next/font's compile-time loader requires a literal options object per call — no spread,
// no shared variables. Hence the repetition below.

// Variable Google families — weight omitted (full axis loaded; heading weight applied inline).
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-inter" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-source-sans" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-manrope" });
const signika = Signika({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-signika" });
const merriweatherSans = Merriweather_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-merriweather-sans" });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-montserrat" });
const merriweather = Merriweather({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-merriweather" });
const lora = Lora({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-lora" });
const dancingScript = Dancing_Script({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-dancing-script" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-jetbrains-mono" });
const atkinsonNext = Atkinson_Hyperlegible_Next({ subsets: ["latin"], display: "swap", preload: false, variable: "--gf-atkinson-next" });

// Static Google families — explicit weights required.
const libreBaskerville = Libre_Baskerville({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--gf-libre-baskerville" });
const bebasNeue = Bebas_Neue({ subsets: ["latin"], weight: "400", display: "swap", preload: false, variable: "--gf-bebas-neue" });
const abrilFatface = Abril_Fatface({ subsets: ["latin"], weight: "400", display: "swap", preload: false, variable: "--gf-abril-fatface" });
const poiretOne = Poiret_One({ subsets: ["latin"], weight: "400", display: "swap", preload: false, variable: "--gf-poiret-one" });
const amaticSC = Amatic_SC({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--gf-amatic-sc" });
const oleoScript = Oleo_Script({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--gf-oleo-script" });
const pacifico = Pacifico({ subsets: ["latin"], weight: "400", display: "swap", preload: false, variable: "--gf-pacifico" });
const pinyonScript = Pinyon_Script({ subsets: ["latin"], weight: "400", display: "swap", preload: false, variable: "--gf-pinyon-script" });

// Vendored (non-Google) accessibility families — src is relative to this file.
const atkinsonMono = localFont({
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--gf-atkinson-mono",
  src: [
    { path: "../fonts/AtkinsonHyperlegibleMono-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/AtkinsonHyperlegibleMono-700.woff2", weight: "700", style: "normal" },
  ],
});
const openDyslexic = localFont({
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--gf-opendyslexic",
  src: [
    { path: "../fonts/OpenDyslexic-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/OpenDyslexic-700.woff2", weight: "700", style: "normal" },
  ],
});
const dejavuSans = localFont({
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--gf-dejavu-sans",
  src: [
    { path: "../fonts/DejaVuSans-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/DejaVuSans-700.woff2", weight: "700", style: "normal" },
  ],
});
const dejavuSansMono = localFont({
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--gf-dejavu-sans-mono",
  src: [
    { path: "../fonts/DejaVuSansMono-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/DejaVuSansMono-700.woff2", weight: "700", style: "normal" },
  ],
});

export type FontCategoryId = "sans" | "serif" | "display" | "mono" | "a11y";

export interface GalleryFont {
  /** Stored value of `opener_font`. */
  key: string;
  label: string;
  /** CSS variable holding the font-family (defined globally via the font's `.variable` class). */
  cssVar: string;
  /** Weight the opener heading renders at — single-weight display/script faces use 400. */
  headingWeight: 400 | 700;
}

export interface GalleryFontGroup {
  id: FontCategoryId;
  label: string;
  note: string;
  fonts: GalleryFont[];
}

// `variable` className + the registry metadata, paired so the <html> variable list and the
// rendering map stay derived from the same source.
type Entry = { variable: string } & GalleryFont;

const GROUPS: { id: FontCategoryId; label: string; note: string; entries: Entry[] }[] = [
  {
    id: "sans",
    label: "Sans Serif",
    note: "Neutral / Modern",
    entries: [
      { variable: inter.variable, key: "inter", label: "Inter", cssVar: "--gf-inter", headingWeight: 700 },
      { variable: sourceSans.variable, key: "source-sans-3", label: "Source Sans 3", cssVar: "--gf-source-sans", headingWeight: 700 },
      { variable: manrope.variable, key: "manrope", label: "Manrope", cssVar: "--gf-manrope", headingWeight: 700 },
      { variable: signika.variable, key: "signika", label: "Signika", cssVar: "--gf-signika", headingWeight: 700 },
      { variable: merriweatherSans.variable, key: "merriweather-sans", label: "Merriweather Sans", cssVar: "--gf-merriweather-sans", headingWeight: 700 },
      { variable: montserrat.variable, key: "montserrat", label: "Montserrat", cssVar: "--gf-montserrat", headingWeight: 700 },
    ],
  },
  {
    id: "serif",
    label: "Serif",
    note: "Editorial / Classic",
    entries: [
      { variable: merriweather.variable, key: "merriweather", label: "Merriweather", cssVar: "--gf-merriweather", headingWeight: 700 },
      { variable: lora.variable, key: "lora", label: "Lora", cssVar: "--gf-lora", headingWeight: 700 },
      { variable: libreBaskerville.variable, key: "libre-baskerville", label: "Libre Baskerville", cssVar: "--gf-libre-baskerville", headingWeight: 700 },
    ],
  },
  {
    id: "display",
    label: "Display / Script",
    note: "Accent-only",
    entries: [
      { variable: bebasNeue.variable, key: "bebas-neue", label: "Bebas Neue", cssVar: "--gf-bebas-neue", headingWeight: 400 },
      { variable: abrilFatface.variable, key: "abril-fatface", label: "Abril Fatface", cssVar: "--gf-abril-fatface", headingWeight: 400 },
      { variable: poiretOne.variable, key: "poiret-one", label: "Poiret One", cssVar: "--gf-poiret-one", headingWeight: 400 },
      { variable: amaticSC.variable, key: "amatic-sc", label: "Amatic SC", cssVar: "--gf-amatic-sc", headingWeight: 700 },
      { variable: oleoScript.variable, key: "oleo-script", label: "Oleo Script", cssVar: "--gf-oleo-script", headingWeight: 700 },
      { variable: pacifico.variable, key: "pacifico", label: "Pacifico", cssVar: "--gf-pacifico", headingWeight: 400 },
      { variable: pinyonScript.variable, key: "pinyon-script", label: "Pinyon Script", cssVar: "--gf-pinyon-script", headingWeight: 400 },
      { variable: dancingScript.variable, key: "dancing-script", label: "Dancing Script", cssVar: "--gf-dancing-script", headingWeight: 700 },
    ],
  },
  {
    id: "mono",
    label: "Mono",
    note: "Technical / Metadata",
    entries: [
      { variable: jetbrainsMono.variable, key: "jetbrains-mono", label: "JetBrains Mono", cssVar: "--gf-jetbrains-mono", headingWeight: 700 },
    ],
  },
  {
    id: "a11y",
    label: "Accessibility",
    note: "High legibility",
    entries: [
      { variable: atkinsonNext.variable, key: "atkinson-next", label: "Atkinson Hyperlegible Next", cssVar: "--gf-atkinson-next", headingWeight: 700 },
      { variable: atkinsonMono.variable, key: "atkinson-mono", label: "Atkinson Hyperlegible Mono", cssVar: "--gf-atkinson-mono", headingWeight: 700 },
      { variable: openDyslexic.variable, key: "opendyslexic", label: "OpenDyslexic", cssVar: "--gf-opendyslexic", headingWeight: 700 },
      { variable: dejavuSans.variable, key: "dejavu-sans", label: "DejaVu Sans", cssVar: "--gf-dejavu-sans", headingWeight: 700 },
      { variable: dejavuSansMono.variable, key: "dejavu-sans-mono", label: "DejaVu Sans Mono", cssVar: "--gf-dejavu-sans-mono", headingWeight: 700 },
    ],
  },
];

/** Grouped font list for the picker UI. */
export const GALLERY_FONT_GROUPS: GalleryFontGroup[] = GROUPS.map((g) => ({
  id: g.id,
  label: g.label,
  note: g.note,
  fonts: g.entries.map(({ key, label, cssVar, headingWeight }) => ({ key, label, cssVar, headingWeight })),
}));

const FONT_BY_KEY: Record<string, GalleryFont> = Object.fromEntries(
  GROUPS.flatMap((g) => g.entries).map((e) => [e.key, { key: e.key, label: e.label, cssVar: e.cssVar, headingWeight: e.headingWeight }]),
);

/** Space-joined `.variable` classNames for every font — applied to <html> in layout.tsx. */
export const GALLERY_FONT_VARIABLES = GROUPS.flatMap((g) => g.entries.map((e) => e.variable)).join(" ");

// Legacy values that predate the named registry — keep rendering exactly as before.
const LEGACY: Record<string, { fontFamily: string }> = {
  sans: { fontFamily: "var(--font-sans)" },
  serif: { fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif' },
  mono: { fontFamily: "var(--font-mono)" },
};

export interface OpenerFontStyle {
  fontFamily: string;
  fontWeight: number;
}

/** Resolve a stored `opener_font` key to inline styles for the opener heading. */
export function resolveOpenerFont(key: string | null | undefined): OpenerFontStyle {
  const font = key ? FONT_BY_KEY[key] : undefined;
  if (font) return { fontFamily: `var(${font.cssVar})`, fontWeight: font.headingWeight };
  const legacy = (key && LEGACY[key]) || LEGACY.sans;
  return { fontFamily: legacy.fontFamily, fontWeight: 700 };
}

/** Label for a stored key (falls back to a humanized legacy name). */
export function openerFontLabel(key: string | null | undefined): string {
  if (key && FONT_BY_KEY[key]) return FONT_BY_KEY[key].label;
  if (key === "serif") return "Serif (default)";
  if (key === "mono") return "Mono (default)";
  return "Sans (default)";
}
