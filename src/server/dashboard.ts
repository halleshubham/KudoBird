import { withTenant } from "./db";
import { ymd } from "../lib/format";
import { assertCan } from "./permissions";
import type { OrgContext } from "./orgs";

export interface DashboardData {
  days: number;
  totals: { certificates: number; thisMonth: number; entries: number; pending: number; views: number; shares: number };
  series: { date: string; count: number }[];
  sharesByPlatform: { platform: string; count: number }[];
  topCampaigns: { id: string; name: string; certificates: number; views: number; shares: number }[];
}


/** Everything the dashboard needs, in a few grouped queries (no per-row work in the database layer). */
export async function getDashboard(ctx: OrgContext, days = 30): Promise<DashboardData> {
  assertCan(ctx.role, "stats.view");
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return withTenant(ctx, async (tx) => {
    const [certificates, thisMonth, entries, pending, events, perCampaignCerts, recent, campaigns] = await Promise.all([
      tx.certificate.count({ where: { orgId: ctx.orgId } }),
      tx.certificate.count({ where: { orgId: ctx.orgId, issuedAt: { gte: monthStart } } }),
      tx.entry.count({ where: { orgId: ctx.orgId } }),
      tx.entry.count({ where: { orgId: ctx.orgId, status: "PENDING" } }),
      tx.certificateEvent.groupBy({ by: ["campaignId", "type", "platform"], where: { orgId: ctx.orgId }, _count: true }),
      tx.certificate.groupBy({ by: ["campaignId"], where: { orgId: ctx.orgId }, _count: true }),
      tx.certificate.findMany({ where: { orgId: ctx.orgId, issuedAt: { gte: since } }, select: { issuedAt: true }, take: 50_000 }),
      tx.campaign.findMany({ where: { orgId: ctx.orgId, archivedAt: null }, select: { id: true, name: true } }),
    ]);
    const buckets = new Map<string, number>();
    for (let i = 0; i < days; i++) buckets.set(ymd(new Date(since.getTime() + i * 86_400_000)), 0);
    for (const r of recent) { const k = ymd(r.issuedAt); if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1); }
    const shares = events.filter((e) => e.type === "SHARE");
    const byPlatform = new Map<string, number>();
    for (const e of shares) byPlatform.set(e.platform, (byPlatform.get(e.platform) ?? 0) + e._count);
    const perCampaign = new Map<string, number>(); // `${campaignId}:${type}` -> count
    for (const e of events) { const k = `${e.campaignId}:${e.type}`; perCampaign.set(k, (perCampaign.get(k) ?? 0) + e._count); }
    const certsByCampaign = new Map(perCampaignCerts.map((p) => [p.campaignId, p._count]));
    const sum = (id: string, t: string) => perCampaign.get(`${id}:${t}`) ?? 0;
    return {
      days,
      totals: { certificates, thisMonth, entries, pending, views: events.filter((e) => e.type === "VIEW").reduce((n, e) => n + e._count, 0), shares: shares.reduce((n, e) => n + e._count, 0) },
      series: [...buckets].map(([date, count]) => ({ date, count })),
      sharesByPlatform: [...byPlatform].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
      topCampaigns: campaigns
        .map((c) => ({ id: c.id, name: c.name, certificates: certsByCampaign.get(c.id) ?? 0, views: sum(c.id, "VIEW"), shares: sum(c.id, "SHARE") }))
        .sort((a, b) => b.certificates - a.certificates).slice(0, 5),
    };
  });
}
