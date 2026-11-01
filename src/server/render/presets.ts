import type { Design, Block } from "./design";
import { DEFAULT_DEVANAGARI_FONT } from "../fonts/curated";

export const PRESETS = ["classic", "modern", "minimal", "festive"] as const;
export type Preset = (typeof PRESETS)[number];
export type Locale = "en" | "hi" | "mr";

const TEXT: Record<Locale, { title: string; subtitle: string; body: string; footer: string }> = {
  en: { title: "Certificate of Appreciation", subtitle: "is proudly presented to", body: "in grateful recognition of the valued contribution to {{campaign}}.", footer: "{{org}} · {{date}}" },
  hi: { title: "प्रशंसा प्रमाणपत्र", subtitle: "यह प्रमाणपत्र सम्मानपूर्वक प्रदान किया जाता है", body: "{{campaign}} में आपके बहुमूल्य योगदान के लिए आभार सहित।", footer: "{{org}} · {{date}}" },
  mr: { title: "कृतज्ञता प्रमाणपत्र", subtitle: "हे प्रमाणपत्र सन्मानपूर्वक प्रदान करण्यात येत आहे", body: "{{campaign}} मधील आपल्या बहुमोल योगदानाबद्दल कृतज्ञतापूर्वक.", footer: "{{org}} · {{date}}" },
};

const block = (text: string, o: Partial<Block> & { font: string; size: number; color: string }): Block => ({
  show: true, weight: 400, align: "center", italic: false, text, ...o,
});

/** Starter layouts. Locale only changes default wording and the default font (Devanagari-safe). */
export function presetDesign(preset: Preset, locale: Locale = "en"): Design {
  const t = TEXT[locale];
  const deva = locale !== "en";
  const serif = deva ? DEFAULT_DEVANAGARI_FONT : "Playfair Display";
  const sans = deva ? "Noto Sans Devanagari" : "Montserrat";

  switch (preset) {
    case "classic":
      return {
        version: 1, preset,
        background: { color: "#fffdf7", gradientTo: null, assetId: null },
        border: { style: "double", color: "#8a6d1d", width: 0.9, inset: 3 },
        logos: { assetIds: [], position: "top-center", height: 10 },
        blocks: {
          title: block(t.title, { font: serif, size: 6.2, weight: 700, color: "#5b4410" }),
          subtitle: block(t.subtitle, { font: serif, size: 2.6, color: "#444444", italic: !deva }),
          recipient: block("{{name}}", { font: serif, size: 7.5, weight: 700, color: "#1f1f1f" }),
          body: block(t.body, { font: serif, size: 2.8, color: "#333333" }),
          footer: block(t.footer, { font: serif, size: 2.2, color: "#6b6b6b" }),
        },
        signatories: { show: true, font: serif, color: "#333333", size: 2.4 },
        qr: { show: true, position: "bottom-right", size: 9 },
      };
    case "modern":
      return {
        version: 1, preset,
        background: { color: "#ffffff", gradientTo: "#eef2ff", assetId: null },
        border: { style: "solid", color: "#4f46e5", width: 2.2, inset: 0 },
        logos: { assetIds: [], position: "top-left", height: 9 },
        blocks: {
          title: block(t.title, { font: sans, size: 5.6, weight: 800, align: "left", color: "#312e81" }),
          subtitle: block(t.subtitle, { font: sans, size: 2.4, align: "left", color: "#4b5563" }),
          recipient: block("{{name}}", { font: sans, size: 7, weight: 800, align: "left", color: "#111827" }),
          body: block(t.body, { font: sans, size: 2.7, align: "left", color: "#374151" }),
          footer: block(t.footer, { font: sans, size: 2.1, align: "left", color: "#6b7280" }),
        },
        signatories: { show: true, font: sans, color: "#374151", size: 2.3 },
        qr: { show: true, position: "bottom-right", size: 9 },
      };
    case "minimal":
      return {
        version: 1, preset,
        background: { color: "#ffffff", gradientTo: null, assetId: null },
        border: { style: "none", color: "#000000", width: 0, inset: 0 },
        logos: { assetIds: [], position: "top-center", height: 8 },
        blocks: {
          title: block(t.title, { font: serif, size: 4.6, weight: 400, color: "#111111" }),
          subtitle: block(t.subtitle, { font: sans, size: 2.2, color: "#777777" }),
          recipient: block("{{name}}", { font: serif, size: 8, weight: 400, color: "#111111" }),
          body: block(t.body, { font: sans, size: 2.5, color: "#555555" }),
          footer: block(t.footer, { font: sans, size: 2, color: "#999999" }),
        },
        signatories: { show: true, font: sans, color: "#555555", size: 2.2 },
        qr: { show: true, position: "bottom-left", size: 8 },
      };
    case "festive":
      return {
        version: 1, preset,
        background: { color: "#fff7e6", gradientTo: "#ffe2b8", assetId: null },
        border: { style: "ornate", color: "#b45309", width: 1.2, inset: 2.6 },
        logos: { assetIds: [], position: "top-center", height: 10 },
        blocks: {
          title: block(t.title, { font: serif, size: 6.2, weight: 700, color: "#9a3412" }),
          subtitle: block(t.subtitle, { font: serif, size: 2.6, color: "#7c2d12" }),
          recipient: block("{{name}}", { font: serif, size: 7.5, weight: 700, color: "#7f1d1d" }),
          body: block(t.body, { font: serif, size: 2.8, color: "#431407" }),
          footer: block(t.footer, { font: serif, size: 2.2, color: "#9a3412" }),
        },
        signatories: { show: true, font: serif, color: "#431407", size: 2.4 },
        qr: { show: true, position: "bottom-right", size: 9 },
      };
  }
}

export const PRESET_INFO: Record<Preset, { name: string; description: string }> = {
  classic: { name: "Classic", description: "Gold double border, serif type, formal." },
  modern: { name: "Modern", description: "Clean left-aligned layout with an indigo frame." },
  minimal: { name: "Minimal", description: "Lots of white space, no border." },
  festive: { name: "Indian festive", description: "Warm saffron tones with an ornate border." },
};
