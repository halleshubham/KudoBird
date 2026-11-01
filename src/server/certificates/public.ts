import { withPlatform } from "../db";
import { parseSettings } from "../campaigns/schema";
import type { OutputKey } from "../render/build";

type Outputs = Record<string, { key: string; hash: string; mime: string }>;

/** Public-safe view of a certificate. Mobile and email never leave the database through this module. */
export async function getPublicCertificate(publicId: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(publicId)) return null;
  const c = await withPlatform((tx) =>
    tx.certificate.findUnique({ where: { publicId }, include: { campaign: { select: { name: true, slug: true, settings: true, org: { select: { name: true, slug: true } } } } } }),
  );
  if (!c) return null;
  const data = c.renderData as Record<string, string>;
  const outputs = c.outputs as Outputs;
  const settings = parseSettings(c.campaign.settings);
  return {
    id: c.id, publicId: c.publicId, number: c.number, name: data.name, status: c.status, revokedAt: c.revokedAt, issuedAt: c.issuedAt,
    renderStatus: c.renderStatus, locale: c.locale, outputs: Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, { hash: v.hash, mime: v.mime }])),
    // Only what a public visitor needs. Internal configuration (approval, retention, ...) stays private.
    campaign: { name: c.campaign.name, slug: c.campaign.slug, shareText: settings.shareText, hashtags: settings.hashtags }, org: c.campaign.org,
  };
}

export async function getCertificateOutput(publicId: string, key: OutputKey) {
  const c = await withPlatform((tx) => tx.certificate.findUnique({ where: { publicId }, select: { outputs: true, number: true } }));
  const o = (c?.outputs as Outputs | undefined)?.[key];
  return c && o ? { ...o, number: c.number } : null;
}
