import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium, type Browser } from "playwright";
import { fontFaceCss } from "@/server/fonts";
import { presetDesign } from "@/server/render/presets";
import { renderCertificateHtml } from "@/server/render/html";
import { buildCertificateHtml, contentHash, type CertificateSource } from "@/server/render/build";
import { optimizePng, renderHtml } from "../src/worker/render";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); });
afterAll(async () => { await browser.close(); });

// The samples from the product brief: conjuncts, matras, reph, ZWJ forms.
const SAMPLES = ["बळीराजाची दिवाळी", "दुष्काळग्रस्त", "क्ष्म्य", "श्री", "र्‍य"];
const FONT = "Noto Serif Devanagari";
const NO_SHAPING = `"ccmp" 0,"locl" 0,"nukt" 0,"akhn" 0,"rphf" 0,"rkrf" 0,"blwf" 0,"half" 0,"pstf" 0,"vatu" 0,"cjct" 0,"pres" 0,"abvs" 0,"blws" 0,"psts" 0,"haln" 0,"abvm" 0,"blwm" 0,"kern" 0,"mark" 0,"mkmk" 0,"liga" 0,"clig" 0`;

async function sample(text: string, features = "normal") {
  const css = await fontFaceCss([FONT], "inline");
  const html = `<!doctype html><meta charset=utf-8><style>${css}body{margin:0;background:#fff}#t{display:inline-block;font:400 96px/1.6 '${FONT}';padding:20px 30px;color:#000;white-space:nowrap;font-feature-settings:${features}}</style><span id=t>${text}</span>`;
  const context = await browser.newContext({ viewport: { width: 900, height: 220 } });
  try {
    const page = await context.newPage();
    await page.setContent(html);
    await page.evaluate(async () => { await document.fonts.ready; });
    const loaded = await page.evaluate((t) => document.fonts.check(`96px 'Noto Serif Devanagari'`, t), text);
    const width = await page.evaluate(() => document.getElementById("t")!.getBoundingClientRect().width);
    const png = await page.screenshot({ type: "png" });
    return { loaded, width, png };
  } finally { await context.close(); }
}

const diff = (a: Buffer, b: Buffer) => {
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return 1;
  return pixelmatch(A.data, B.data, null, A.width, A.height, { threshold: 0.1 }) / (A.width * A.height);
};

describe("Devanagari shaping in headless Chromium", () => {
  it.each(SAMPLES)("%s: embedded font is used and the text is shaped", async (text) => {
    const shaped = await sample(text);
    expect(shaped.loaded).toBe(true);
    expect(shaped.width).toBeGreaterThan(40);
  });

  it.each(SAMPLES.slice(1))("%s: output differs from unshaped rendering (conjunct/reph/matra forms are applied)", async (text) => {
    const shaped = await sample(text);
    const raw = await sample(text, NO_SHAPING);
    // Substantial pixel difference proves OpenType shaping (akhn/rphf/blwf/pres...) is active, not letters laid out one by one.
    expect(diff(shaped.png, raw.png)).toBeGreaterThan(0.002);
  });

  it("conjuncts are narrower than their unshaped letter sequence", async () => {
    for (const text of ["क्ष्म्य", "दुष्काळग्रस्त"]) {
      expect((await sample(text)).width).toBeLessThan((await sample(text, NO_SHAPING)).width);
    }
  });

  it.each(SAMPLES.map((s, i) => [i, s] as const))("golden image %i (%s) matches", async (i, text) => {
    const { png } = await sample(text);
    const file = path.join(__dirname, "__golden__", `devanagari-${i}.png`);
    if (!existsSync(file) || process.env.UPDATE_GOLDEN) { writeFileSync(file, png); return; }
    // Coarse regression net only (a missing glyph or tofu changes far more than this). Text anti-aliasing differs slightly between
    // machines, so a tight tolerance fails on CI for no reason; correct shaping is asserted precisely by the tests above.
    expect(diff(png, readFileSync(file))).toBeLessThan(0.015);
  });
});

describe("render pipeline", () => {
  const src = (over: Partial<CertificateSource> = {}): CertificateSource => ({
    id: "x", publicId: "AAAAAAAAAAAAAAAAAAAAAA", orgId: "00000000-0000-0000-0000-000000000000", status: "ACTIVE",
    design: presetDesign("festive", "mr"), signatories: [{ name: "डॉ. सुनील", designation: "अध्यक्ष", assetId: null }],
    renderData: { name: "बळीराजा पाटील", campaign: "बळीराजाची दिवाळी", org: "संस्था", date: "१ नोव्हेंबर २०२६", certificate_no: "BD-2026-00042" }, ...over,
  });

  it("the stored PNG is optimised: same size, much smaller, visually the same", async () => {
    for (const key of ["square", "story", "link", "a4"] as const) {
      const { html, size } = await buildCertificateHtml(src(), key);
      const raw = await renderHtml(browser, html, size, "png");
      const small = await optimizePng(raw);
      const a = PNG.sync.read(raw), b = PNG.sync.read(small);
      expect([b.width, b.height]).toEqual([a.width, a.height]);
      expect(small.length).toBeLessThan(raw.length * 0.5); // typically 15-25% of the original
      let off = 0;
      for (let i = 0; i < a.data.length; i += 4) if (Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])) > 32) off++;
      expect(off / (a.width * a.height)).toBeLessThan(0.005); // under 0.5% of pixels visibly different
    }
  });

  it("produces PNGs at exactly the required sizes and a one-page A4 PDF", async () => {
    const dims: Record<string, [number, number]> = { square: [1080, 1080], story: [1080, 1920], link: [1200, 630], a4: [1754, 1240] };
    for (const [key, [w, h]] of Object.entries(dims)) {
      const { html, size } = await buildCertificateHtml(src(), key as "square");
      const png = PNG.sync.read(await renderHtml(browser, html, size, "png"));
      expect([png.width, png.height]).toEqual([w, h]);
    }
    const { html, size } = await buildCertificateHtml(src(), "pdf");
    const pdf = await renderHtml(browser, html, size, "pdf");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  });

  it("never touches the network: external resources are blocked during rendering", async () => {
    let hits = 0;
    const server = createServer((_, res) => { hits++; res.end("x"); }).listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const html = `<!doctype html><img src="http://127.0.0.1:${port}/a.png"><link rel=stylesheet href="http://127.0.0.1:${port}/b.css"><div style="font-family:'Noto Serif Devanagari'">श्री</div>`;
      await renderHtml(browser, html, { w: 600, h: 400 }, "png"); // a realistic page size (a 200x100 page failed to screenshot on one CI runner)
      expect(hits).toBe(0);
    } finally { server.close(); }
  });

  it("revoked certificates carry a visible REVOKED stamp and a different content hash", async () => {
    const a = src(), b = src({ status: "REVOKED" });
    expect(contentHash(a, "square")).not.toBe(contentHash(b, "square"));
    const normal = await renderHtml(browser, (await buildCertificateHtml(a, "link")).html, { w: 1200, h: 630 }, "png");
    const revoked = await renderHtml(browser, (await buildCertificateHtml(b, "link")).html, { w: 1200, h: 630 }, "png");
    expect(diff(normal, revoked)).toBeGreaterThan(0.01);
  });

  it("content hash is stable for identical input and changes with the design or data", () => {
    expect(contentHash(src(), "square")).toBe(contentHash(src(), "square"));
    expect(contentHash(src(), "square")).not.toBe(contentHash(src(), "story"));
    expect(contentHash(src(), "square")).not.toBe(contentHash(src({ renderData: { ...src().renderData, name: "Other" } }), "square"));
  });

  it("all four presets render in all three languages without layout overflow of the canvas", async () => {
    for (const preset of ["classic", "modern", "minimal", "festive"] as const) for (const l of ["en", "hi", "mr"] as const) {
      const design = presetDesign(preset, l);
      const css = await fontFaceCss([...new Set([...Object.values(design.blocks).map((b) => b.font), design.signatories.font])], "inline");
      const html = renderCertificateHtml({ design, data: { name: "अनुराधा शर्मा-देशपांडे", campaign: "मोहीम", org: "संस्था", date: "१ नोव्हेंबर २०२६", certificate_no: "X-1" }, assets: {}, signatories: [{ name: "A", designation: "B" }, { name: "C", designation: "D" }], size: { w: 1200, h: 630 }, fontCss: css });
      const context = await browser.newContext({ viewport: { width: 1200, height: 630 } });
      const page = await context.newPage();
      await page.setContent(html);
      await page.evaluate(async () => { await document.fonts.ready; });
      const overflow = await page.evaluate(() => { const p = document.querySelector(".page") as HTMLElement; return p.scrollHeight - p.clientHeight; });
      await context.close();
      expect(overflow, `${preset}/${l}`).toBeLessThanOrEqual(1);
    }
  });
});
