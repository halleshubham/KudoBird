import { currentPeriod, loadEntitlements, getUsage, LIMIT_KEYS } from "@/server/entitlements";
import { withTenant } from "@/server/db";
import { requireOrg } from "@/server/session";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const { ctx } = await requireOrg();
  const { forbidden } = await searchParams;
  const { org, usage, limits, plan } = await withTenant(ctx, async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { plan: true } });
    const ent = await loadEntitlements(tx, ctx.orgId);
    const usage = Object.fromEntries(await Promise.all(LIMIT_KEYS.map(async (k) => [k, await getUsage(tx, ctx.orgId, k)])));
    return { org, usage, limits: ent.limits as Record<string, number | undefined>, plan: org.plan };
  });
  return (
    <div className="space-y-6">
      {forbidden && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">You do not have permission to view that page.</p>}
      <div>
        <h1 className="text-2xl font-bold">{org.name}</h1>
        <p className="text-sm text-gray-600">Plan: {plan.name} · usage for {currentPeriod()}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {LIMIT_KEYS.map((k) => {
          const max = limits[k];
          return (
            <div key={k} className="card">
              <p className="text-xs uppercase tracking-wide text-gray-500">{k}</p>
              <p className="text-2xl font-semibold">{usage[k]} <span className="text-sm font-normal text-gray-500">/ {max === undefined || max < 0 ? "∞" : max}</span></p>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-gray-500">Campaigns, certificates and analytics arrive in the next stages.</p>
    </div>
  );
}
