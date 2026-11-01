import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { withPlatform } from "../db";
import { env } from "../env";
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

async function assetDataUri(orgId: string, assetId: string): Promise<string | null> {
  const a = await withPlatform((tx) => tx.asset.findFirst({ where: { id: assetId, orgId } }));
  if (!a) return null;
  const body = await getStorage().get(a.storageKey);
  return body ? `data:${a.mime};base64,${body.toString("base64")}` : null;
}

/** Everything that affects the pixels. Same hash => cached output can be reused. */
export function contentHash(src: CertificateSource, key: OutputKey): string {
  return createHash("sha256").update(JSON.stringify({ v: 2, key, d: src.design, r: src.renderData, s: src.signatories, x: src.status })).digest("hex").slice(0, 16);
}

/** Self-contained HTML for one output: images and fonts embedded, no network needed. */
export async function buildCertificateHtml(src: CertificateSource, key: OutputKey): Promise<{ html: string; size: { w: number; h: number } }> {
  const size = key === "pdf" ? A4_PDF_SIZE : OUTPUT_SIZES[key];
  const assets: Record<string, string> = {};
  const ids = [...src.design.logos.assetIds, src.design.background.assetId, ...src.signatories.map((s) => s.assetId)].filter(Boolean) as string[];
  await Promise.all([...new Set(ids)].map(async (id) => { const uri = await assetDataUri(src.orgId, id); if (uri) assets[id] = uri; }));
  const qrSrc = await QRCode.toDataURL(new URL(`/c/${src.publicId}`, env().APP_URL).toString(), { margin: 0, width: 360, errorCorrectionLevel: "M" });
  const html = renderCertificateHtml({
    design: src.design, data: src.renderData, assets,
    signatories: src.signatories.map((s) => ({ name: s.name, designation: s.designation, imageSrc: s.assetId ? assets[s.assetId] ?? null : null })),
    qrSrc, size, fontCss: await fontFaceCss(designFonts(src.design), "inline"), revoked: src.status === "REVOKED",
  });
  return { html, size };
}
