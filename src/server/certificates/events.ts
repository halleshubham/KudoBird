import { withPlatform, withTenant } from "../db";
import { OrgError, type OrgContext } from "../orgs";
import { assertCan } from "../permissions";
import { sha256 } from "../crypto";
import { rateLimit } from "../security/ratelimit";

export const SHARE_PLATFORMS = ["whatsapp", "facebook", "x", "linkedin", "telegram", "copy", "native", "instagram", "download"] as const;
/** Where a page view came from: a share platform (via ?s=), an email link, the QR code, or nothing. */
export const VIEW_SOURCES = [...SHARE_PLATFORMS, "email", "qr", "direct"] as const;

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|headless|lighthouse|curl|wget|python-requests/i;

export type RecordResult = "recorded" | "ignored" | "invalid" | "rate_limited" | "not_found";

/** Records a page view or a share click. Bots and link-preview fetchers are ignored for views. */
export async function recordCertificateEvent(publicId: string, input: { type: string; platform?: string }, ctx: { ip: string; userAgent?: string }): Promise<RecordResult> {
  const type = input.type === "VIEW" || input.type === "SHARE" ? input.type : null;
  if (!type) return "invalid";
  const allowed: readonly string[] = type === "SHARE" ? SHARE_PLATFORMS : VIEW_SOURCES;
  const platform = input.platform && allowed.includes(input.platform) ? input.platform : type === "VIEW" ? "direct" : null;
  if (!platform) return "invalid";
  if (type === "VIEW" && (!ctx.userAgent || BOT.test(ctx.userAgent))) return "ignored";
  if (!(await rateLimit(`ev:${sha256(ctx.ip)}`, 120, 600)).allowed) return "rate_limited";
  const cert = await withPlatform((tx) => tx.certificate.findUnique({ where: { publicId }, select: { id: true, orgId: true, campaignId: true } }));
  if (!cert) return "not_found";
  await withPlatform((tx) => tx.certificateEvent.create({ data: { orgId: cert.orgId, campaignId: cert.campaignId, certificateId: cert.id, type, platform } }));
  return "recorded";
}

export async function getCampaignStats(ctx: OrgContext, campaignId: string) {
  assertCan(ctx.role, "stats.view");
  return withTenant(ctx, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id: campaignId, orgId: ctx.orgId }, select: { id: true } });
    if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
    const [events, certificates, entries] = await Promise.all([
      tx.certificateEvent.groupBy({ by: ["type", "platform"], where: { orgId: ctx.orgId, campaignId }, _count: true }),
      tx.certificate.count({ where: { orgId: ctx.orgId, campaignId } }),
      tx.entry.groupBy({ by: ["status"], where: { orgId: ctx.orgId, campaignId }, _count: true }),
    ]);
    const sum = (t: string) => events.filter((e) => e.type === t).reduce((n, e) => n + e._count, 0);
    const by = (t: string) => Object.fromEntries(events.filter((e) => e.type === t).map((e) => [e.platform, e._count]));
    return {
      certificates, views: sum("VIEW"), shares: sum("SHARE"), sharesByPlatform: by("SHARE") as Record<string, number>, viewsBySource: by("VIEW") as Record<string, number>,
      entries: Object.fromEntries(entries.map((e) => [e.status, e._count])) as Record<string, number>,
    };
  });
}

/** Names of contributors who opted in to the public wall (and whose certificate is still valid). */
export async function getWall(orgSlug: string, campaignSlug: string, take = 200) {
  const campaign = await withPlatform((tx) =>
    tx.campaign.findFirst({ where: { slug: campaignSlug, archivedAt: null, status: { not: "DRAFT" }, org: { slug: orgSlug, status: "ACTIVE", deletedAt: null } }, include: { org: { select: { name: true } } } }),
  );
  if (!campaign) return null;
  const settings = (campaign.settings ?? {}) as { wallEnabled?: boolean };
  if (!settings.wallEnabled) return { campaign, names: [] as string[], enabled: false };
  const rows = await withPlatform((tx) =>
    tx.entry.findMany({ where: { campaignId: campaign.id, wallOptIn: true, status: "APPROVED", certificate: { is: { status: "ACTIVE" } } }, orderBy: { createdAt: "desc" }, take, select: { name: true } }),
  );
  return { campaign, names: rows.map((r) => r.name), enabled: true };
}
