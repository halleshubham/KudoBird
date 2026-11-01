import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { BUNDLED_FONTS, CURATED_FONTS, DEFAULT_WEIGHTS } from "./curated";

const BUNDLED_DIR = path.join(process.cwd(), "assets", "fonts");
const CACHE_DIR = process.env.FONT_CACHE_DIR ?? path.join(process.cwd(), "storage", "fonts");
// Google serves woff2 split by unicode-range only to modern browsers.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const fontSlug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

interface Face { weight: number; subset: string; unicodeRange: string; file: string }
interface Manifest { family: string; faces: Face[]; requested?: number[] }

// --------------------------------------------------------------- catalogue

interface GoogleMeta { familyMetadataList: { family: string; category: string; subsets: string[]; fonts: Record<string, unknown>; popularity: number }[] }

/** Pulls the Google Fonts catalogue (no API key needed) into the Font table. */
export async function syncFontCatalogue(): Promise<number> {
  const res = await fetch("https://fonts.google.com/metadata/fonts");
  if (!res.ok) throw new Error(`Google Fonts metadata request failed: ${res.status}`);
  const meta = JSON.parse((await res.text()).replace(/^\)\]\}'/, "")) as GoogleMeta;
  const curated = new Set(CURATED_FONTS);
  const bundled = new Set<string>(BUNDLED_FONTS);
  const rows = meta.familyMetadataList.map((f) => ({
    family: f.family,
    category: f.category,
    subsets: f.subsets,
    weights: [...new Set(Object.keys(f.fonts).filter((k) => /^\d+$/.test(k)).map(Number))].sort((a, b) => a - b),
    popularity: f.popularity,
    curated: curated.has(f.family),
    bundled: bundled.has(f.family),
  }));
  // Admin curation wins: a re-sync refreshes metadata (subsets, weights, popularity) but never touches curated/bundled of existing rows.
  for (let i = 0; i < rows.length; i += 100) {
    await prisma.$transaction(rows.slice(i, i + 100).map((r) => prisma.font.upsert({ where: { family: r.family }, create: r, update: { category: r.category, subsets: r.subsets, weights: r.weights, popularity: r.popularity } })));
  }
  return rows.length;
}

export interface FontQuery { q?: string; subset?: string; limit?: number }

/** Curated shortlist first (when no search), then the rest by popularity. */
export async function listFonts({ q, subset, limit = 60 }: FontQuery = {}) {
  const where = {
    ...(q ? { family: { contains: q, mode: "insensitive" as const } } : {}),
    ...(subset ? { subsets: { has: subset } } : {}),
  };
  const fonts = await prisma.font.findMany({ where, orderBy: [{ curated: "desc" }, { popularity: "asc" }], take: limit });
  return fonts.map((f) => ({ family: f.family, category: f.category, subsets: f.subsets, weights: f.weights, curated: f.curated, bundled: f.bundled }));
}

// --------------------------------------------------------------- files

async function readManifest(dir: string, family: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, fontSlug(family), "manifest.json"), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

function parseFaces(css: string): { weight: number; subset: string; unicodeRange: string; url: string }[] {
  const out: { weight: number; subset: string; unicodeRange: string; url: string }[] = [];
  for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g)) {
    const body = m[2];
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1];
    const url = body.match(/url\((https:[^)]+)\)/)?.[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
    if (weight && url) out.push({ weight: Number(weight), subset: m[1], unicodeRange: range.trim(), url });
  }
  return out;
}

/**
 * Makes sure the font's woff2 files exist locally (bundled dir or cache dir),
 * downloading from Google Fonts only the first time. Rendering therefore never
 * depends on a live network call once a template has been saved.
 */
export async function ensureFont(family: string, weights: number[] = DEFAULT_WEIGHTS): Promise<{ dir: string; manifest: Manifest }> {
  for (const dir of [BUNDLED_DIR, CACHE_DIR]) {
    const m = await readManifest(dir, family);
    if (m && weights.every((w) => (m.requested ?? []).includes(w) || m.faces.some((f) => f.weight === w))) return { dir, manifest: m };
  }
  const dir = CACHE_DIR;
  const slug = fontSlug(family);
  const existing = (await readManifest(dir, family)) ?? { family, faces: [] };
  const wanted = [...new Set([...weights, ...(existing.requested ?? []), ...existing.faces.map((f) => f.weight)])].sort((a, b) => a - b);
  let css = "";
  // Not every family has every weight; fall back to the default pair, then regular only.
  for (const set of [wanted, DEFAULT_WEIGHTS, [400]]) {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${set.join(";")}&display=swap`, { headers: { "user-agent": UA } });
    if (res.ok) { css = await res.text(); break; }
  }
  if (!css) throw new Error(`Font "${family}" is not available from Google Fonts`);
  await mkdir(path.join(dir, slug), { recursive: true });
  const faces: Face[] = [];
  for (const f of parseFaces(css)) {
    const file = `${f.weight}-${f.subset}.woff2`;
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`Failed to download ${family} ${file}`);
    await writeFile(path.join(dir, slug, file), Buffer.from(await res.arrayBuffer()));
    faces.push({ weight: f.weight, subset: f.subset, unicodeRange: f.unicodeRange, file });
  }
  const manifest: Manifest = { family, faces, requested: wanted };
  await writeFile(path.join(dir, slug, "manifest.json"), JSON.stringify(manifest, null, 1));
  return { dir, manifest };
}

export type FontCssMode = "inline" | "url";

/**
 * @font-face rules for the given fonts. "inline" embeds base64 (used by the render worker:
 * zero network, no file:// restrictions). "url" points at /api/fonts/file (used by the live preview).
 * Weights a family lacks are served by the nearest cached weight.
 */
const inlineCache = new Map<string, string>();
const INLINE_CACHE_MAX = 64;

export async function fontFaceCss(families: string[], mode: FontCssMode, weights: number[] = DEFAULT_WEIGHTS): Promise<string> {
  const unique = [...new Set(families)];
  // Inline CSS is ~0.3-1 MB per family (base64 woff2). Font files never change once cached, so build it once per process.
  const cacheKey = mode === "inline" ? `${[...unique].sort().join("|")}#${weights.join(",")}` : null;
  const hit = cacheKey ? inlineCache.get(cacheKey) : undefined;
  if (hit !== undefined) return hit;
  const parts = await Promise.all(
    unique.map(async (family) => {
      const { dir, manifest } = await ensureFont(family, weights);
      const rules = await Promise.all(
        manifest.faces.map(async (f) => {
          const src =
            mode === "inline"
              ? `data:font/woff2;base64,${(await readFile(path.join(dir, fontSlug(family), f.file))).toString("base64")}`
              : `/api/fonts/file/${fontSlug(family)}/${f.file}`;
          return `@font-face{font-family:'${family}';font-weight:${f.weight};font-style:normal;font-display:block;src:url(${src}) format('woff2');unicode-range:${f.unicodeRange};}`;
        }),
      );
      return rules.join("\n");
    }),
  );
  const css = parts.join("\n");
  if (cacheKey) {
    if (inlineCache.size >= INLINE_CACHE_MAX) inlineCache.delete(inlineCache.keys().next().value as string);
    inlineCache.set(cacheKey, css);
  }
  return css;
}

export async function readFontFile(slug: string, file: string): Promise<Buffer | null> {
  if (!/^[a-z0-9-]+$/.test(slug) || !/^\d+-[\w-]+\.woff2$/.test(file)) return null; // no path traversal
  for (const dir of [BUNDLED_DIR, CACHE_DIR]) {
    try {
      return await readFile(path.join(dir, slug, file));
    } catch {}
  }
  return null;
}
