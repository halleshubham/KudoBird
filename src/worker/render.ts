import type { Browser } from "playwright";
import { withPlatform } from "../server/db";
import { A4_PDF_SIZE, buildCertificateHtml, contentHash, loadCertificateSource, OUTPUT_KEYS, prepareShared, type OutputKey, type SharedRenderInputs } from "../server/render/build";
import { getStorage } from "../server/storage";

type Outputs = Record<string, { key: string; hash: string; mime: string }>;

/** Renders one HTML document to PNG (or PDF) in a fresh, network-less browser context. */
export async function renderHtml(browser: Browser, html: string, size: { w: number; h: number }, kind: "png" | "pdf"): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  try {
    // Rendering must never depend on the network: anything that is not an inline data URI is refused.
    await context.route("**/*", (route) => (/^(data|about|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    // Wait until every embedded font is decoded; otherwise the first paint can use a fallback font.
    await page.evaluate(async () => { await document.fonts.ready; });
    if (kind === "pdf") {
      return Buffer.from(await page.pdf({ width: `${A4_PDF_SIZE.w}px`, height: `${A4_PDF_SIZE.h}px`, printBackground: true, pageRanges: "1" }));
    }
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size.w, height: size.h } });
  } finally {
    await context.close();
  }
}

/**
 * Renders every output size for a certificate, uploading each as soon as it is ready
 * (the page can show the square image while the others are still rendering). Unchanged
 * outputs (same content hash) are reused, which makes retries and "regenerate" cheap.
 */
export async function renderCertificate(browser: Browser, certificateId: string, force = false): Promise<void> {
  const src = await loadCertificateSource(certificateId);
  if (!src) return; // certificate deleted meanwhile
  const current = (await withPlatform((tx) => tx.certificate.update({ where: { id: certificateId }, data: { renderStatus: "RENDERING", renderError: null }, select: { outputs: true } }))).outputs as Outputs | undefined;
  let shared: SharedRenderInputs | undefined; // fonts, images and QR are prepared once, and only if something actually needs rendering
  const outputs: Outputs = force ? {} : { ...(current ?? {}) };
  for (const key of OUTPUT_KEYS) {
    const hash = contentHash(src, key as OutputKey);
    if (outputs[key]?.hash === hash) continue;
    shared ??= await prepareShared(src);
    const { html, size } = await buildCertificateHtml(src, key as OutputKey, shared);
    const pdf = key === "pdf";
    const body = await renderHtml(browser, html, size, pdf ? "pdf" : "png");
    const storageKey = `certificates/${src.orgId}/${src.publicId}/${key}-${hash}.${pdf ? "pdf" : "png"}`;
    await getStorage().put(storageKey, body, pdf ? "application/pdf" : "image/png");
    const old = outputs[key]?.key;
    outputs[key] = { key: storageKey, hash, mime: pdf ? "application/pdf" : "image/png" };
    await withPlatform((tx) => tx.certificate.update({ where: { id: certificateId }, data: { outputs } }));
    if (old && old !== storageKey) await getStorage().delete(old).catch(() => {});
  }
  await withPlatform((tx) => tx.certificate.update({ where: { id: certificateId }, data: { renderStatus: "READY", outputs } }));
}

export async function markFailed(certificateId: string, message: string) {
  await withPlatform((tx) => tx.certificate.updateMany({ where: { id: certificateId }, data: { renderStatus: "FAILED", renderError: message.slice(0, 500) } }));
}
