import { withPlatform } from "../db";
import { currentPeriod } from "../entitlements";
import { emailQueue, renderQueue } from "../queue";
import { assertSuperAdmin } from "./guard";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function getPlatformStats(adminId: string, days = 30) {
  await assertSuperAdmin(adminId);
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const d = await withPlatform(async (tx) => {
    const [orgsByStatus, deletedOrgs, users, admins, certs, certsMonth, entries, pending, recentCerts, recentUsers, usage, perOrgCerts, mail, failedRenders, plans] = await Promise.all([
      tx.organization.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
      tx.organization.count({ where: { deletedAt: { not: null } } }),
      tx.user.count(), tx.user.count({ where: { isSuperAdmin: true } }),
      tx.certificate.count(), tx.certificate.count({ where: { issuedAt: { gte: monthStart } } }),
      tx.entry.count(), tx.entry.count({ where: { status: "PENDING" } }),
      tx.certificate.findMany({ where: { issuedAt: { gte: since } }, select: { issuedAt: true }, take: 100_000 }),
      tx.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true }, take: 100_000 }),
      tx.usageCounter.findMany({ where: { OR: [{ metric: "storage_bytes" }, { period: currentPeriod() }] } }),
      tx.certificate.groupBy({ by: ["orgId"], where: { issuedAt: { gte: monthStart } }, _count: true, orderBy: { _count: { orgId: "desc" } }, take: 5 }),
      tx.emailLog.groupBy({ by: ["status"], where: { createdAt: { gte: since }, kind: { in: ["CERTIFICATE", "REJECTED"] } }, _count: true }),
      tx.certificate.findMany({ where: { renderStatus: "FAILED" }, select: { id: true, number: true, renderError: true, orgId: true }, take: 10, orderBy: { issuedAt: "desc" } }),
      tx.organization.groupBy({ by: ["planId"], where: { deletedAt: null }, _count: true }),
    ]);
    const top = await tx.organization.findMany({ where: { id: { in: perOrgCerts.map((p) => p.orgId) } }, select: { id: true, name: true } });
    const planRows = await tx.plan.findMany({ where: { id: { in: plans.map((p) => p.planId) } }, select: { id: true, name: true } });
    const bucket = (rows: { d: Date }[]) => {
      const m = new Map<string, number>();
      for (let i = 0; i < days; i++) m.set(ymd(new Date(since.getTime() + i * 86_400_000)), 0);
      for (const r of rows) { const k = ymd(r.d); if (m.has(k)) m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m].map(([date, count]) => ({ date, count }));
    };
    const sumMetric = (metric: string) => usage.filter((u) => u.metric === metric).reduce((n, u) => n + Number(u.value), 0);
    const mailCount = (s: string) => mail.find((m) => m.status === s)?._count ?? 0;
    const delivered = mailCount("DELIVERED") + mailCount("SENT");
    const total = mail.reduce((n, m) => n + m._count, 0);
    return {
      days,
      orgs: { active: orgsByStatus.find((o) => o.status === "ACTIVE")?._count ?? 0, suspended: orgsByStatus.find((o) => o.status === "SUSPENDED")?._count ?? 0, deleted: deletedOrgs },
      users: { total: users, admins },
      certificates: { total: certs, thisMonth: certsMonth }, entries: { total: entries, pending },
      emailsThisMonth: sumMetric("emails_sent"), storageBytes: sumMetric("storage_bytes"),
      certificatesPerDay: bucket(recentCerts.map((r) => ({ d: r.issuedAt }))), signupsPerDay: bucket(recentUsers.map((r) => ({ d: r.createdAt }))),
      topOrgs: perOrgCerts.map((p) => ({ id: p.orgId, name: top.find((t) => t.id === p.orgId)?.name ?? "?", certificates: p._count })),
      plans: plans.map((p) => ({ name: planRows.find((r) => r.id === p.planId)?.name ?? "?", orgs: p._count })),
      emailHealth: { total, delivered, bounced: mailCount("BOUNCED"), complained: mailCount("COMPLAINED"), failed: mailCount("FAILED"), suppressed: mailCount("SUPPRESSED") },
      failedRenders,
    };
  });
  return { ...d, queues: await queueHealth() };
}

async function queueHealth() {
  try {
    const [r, e] = await Promise.all([renderQueue().getJobCounts("waiting", "active", "failed", "delayed"), emailQueue().getJobCounts("waiting", "active", "failed", "delayed")]);
    return { ok: true as const, render: r, email: e };
  } catch {
    return { ok: false as const };
  }
}
