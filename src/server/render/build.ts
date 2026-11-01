import { createHash } from "node:crypto";
import { appUrl } from "../urls";
import QRCode from "qrcode";
import { withPlatform } from "../db";

import { fontFaceCss } from "../fonts";
import { getStorage } from "../storage";
import { designFonts, designSchema, type Design } from "./design";
import { renderCertificateHtml } from "./html";
import { OUTPUT_SIZES, type OutputSize } from "./sizes";

export const A4_PDF_SIZE = { w: 1123, h: 794 }; // A4 landscape at 96 dpi, for page.pdf()
export type OutputKey = OutputSize | "pdf";
export const OUTPUT_KEYS: OutputKey[] = ["square", "link", "story", "a4", "pdf"];

export interface CertificateSource {
  id: string; publicId: string; orgId: string; status: "ACTIVE" | "REVOKED";
  design: Design; renderData: Record<string, string>;
  signatories: { name: string; designation: string; assetId: string | null }[];
}

export async function loadCertificateSource(certificateId: string): Promise<CertificateSource | null> {
  return withPlatform(async (tx) => {
    const cert = await tx.certificate.findUnique({ where: { id: certificateId } });
    if (!cert) return null;
    const [version, sigs] = await Promise.all([
      tx.templateVersion.findUniqueOrThrow({ where: { id: cert.templateVersionId } }),
      tx.campaignSignatory.findMany({ where: { campaignId: cert.campaignId }, orderBy: { position: "asc" }, include: { signatory: true } }),
    ]);
    return {
      id: cert.id, publicId: cert.publicId, orgId: cert.orgId, status: cert.status,
      design: designSchema.parse(version.design), renderData: cert.renderData as Record<string, string>,
      signatories: sigs.map((s) => ({ name: s.signatory.name, designation: s.signatory.designation, assetId: s.signatory.assetId })),
    };
  });
}

/** Images are read and base64-encoded once per certificate (not once per output size). One query for all of them. */
async function loadAssetDataUris(orgId: string, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await withPlatform((tx) => tx.asset.findMany({ where: { id: { in: ids }, orgId } }));
  const out: Record<string, string> = {};
  await Promise.all(rows.map(async (a) => { const body = await getStorage().get(a.storageKey); if (body) out[a.id] = `data:${a.mime};base64,${body.toString("base64")}`; }));
  return out;
}

/** Everything that affects the pixels. Same hash => cached output can be reused. */
export function contentHash(src: CertificateSource, key: OutputKey): string {
  return createHash("sha256").update(JSON.stringify({ v: 2, key, d: src.design, r: src.renderData, s: src.signatories, x: src.status })).digest("hex").slice(0, 16);
}

/** Work that is identical for all five outputs of a certificate. Compute once, pass to every buildCertificateHtml call. */
export interface SharedRenderInputs { assets: Record<string, string>; qrSrc: string; fontCss: string }

export async function prepareShared(src: CertificateSource): Promise<SharedRenderInputs> {
  const ids = [...new Set([...src.design.logos.assetIds, src.design.background.assetId, ...src.signatories.map((s) => s.assetId)].filter(Boolean) as string[])];
  const [assets, qrSrc, fontCss] = await Promise.all([
    loadAssetDataUris(src.orgId, ids),
    QRCode.toDataURL(appUrl(`/c/${src.publicId}`), { margin: 0, width: 360, errorCorrectionLevel: "M" }),
    fontFaceCss(designFonts(src.design), "inline"),
  ]);
  return { assets, qrSrc, fontCss };
}

/** Self-contained HTML for one output: images and fonts embedded, no network needed. */
export async function buildCertificateHtml(src: CertificateSource, key: OutputKey, shared?: SharedRenderInputs): Promise<{ html: string; size: { w: number; h: number } }> {
  const size = key === "pdf" ? A4_PDF_SIZE : OUTPUT_SIZES[key];
  const { assets, qrSrc, fontCss } = shared ?? (await prepareShared(src));
  const html = renderCertificateHtml({
    design: src.design, data: src.renderData, assets,
    signatories: src.signatories.map((s) => ({ name: s.name, designation: s.designation, imageSrc: s.assetId ? assets[s.assetId] ?? null : null })),
    qrSrc, size, fontCss, revoked: src.status === "REVOKED",
  });
  return { html, size };
}
