import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withPlatform, withTenant } from "@/server/db";
import { assertFeature, assertWithinLimit, effectiveEntitlements, EntitlementError, recordUsage } from "@/server/entitlements";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
beforeAll(async () => {
  T = await makeOrg();
});
afterAll(async () => {
  await cleanup([T.org.id], T.members.map((m) => m.userId));
  await prisma.$disconnect();
});
const ctx = () => ({ orgId: T.org.id, userId: T.owner.id });

describe("entitlement service", () => {
  it("merges plan values with per-org overrides", () => {
    const e = effectiveEntitlements({ limits: { members: 5, campaigns: 10 }, features: { api: false } } as never, { limits: { members: 50 }, features: { api: true } });
    expect(e.limits).toEqual({ members: 50, campaigns: 10 });
    expect(e.features.api).toBe(true);
  });

  it("unlimited (-1 / undefined) never blocks", async () => {
    await withTenant(ctx(), async (tx) => {
      await recordUsage(tx, T.org.id, "certificates_issued", 1_000_000);
      await expect(assertWithinLimit(tx, T.org.id, "certificatesPerMonth", 1000)).resolves.toBeUndefined();
    });
  });

  it("blocks at the limit using the monthly counter", async () => {
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { emailsPerMonth: 10 } } } }));
    await withTenant(ctx(), async (tx) => {
      await recordUsage(tx, T.org.id, "emails_sent", 9);
      await expect(assertWithinLimit(tx, T.org.id, "emailsPerMonth", 1)).resolves.toBeUndefined();
      await recordUsage(tx, T.org.id, "emails_sent", 1);
      await expect(assertWithinLimit(tx, T.org.id, "emailsPerMonth", 1)).rejects.toMatchObject({ code: "LIMIT_REACHED", key: "emailsPerMonth" });
    });
  });

  it("member count limit is enforced from live data", async () => {
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { members: 1 } } } }));
    await withTenant(ctx(), async (tx) => {
      await expect(assertWithinLimit(tx, T.org.id, "members")).rejects.toBeInstanceOf(EntitlementError);
    });
  });

  it("feature flags gate plan-only features; flipping the plan config enables them", async () => {
    await withTenant(ctx(), async (tx) => {
      await expect(assertFeature(tx, T.org.id, "customDomain")).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    });
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { features: { customDomain: true } } } }));
    await withTenant(ctx(), async (tx) => {
      await expect(assertFeature(tx, T.org.id, "customDomain")).resolves.toBeUndefined();
    });
  });

  it("usage in one org does not affect another", async () => {
    const other = await makeOrg();
    await withTenant({ orgId: other.org.id, userId: other.owner.id }, async (tx) => {
      await expect(assertWithinLimit(tx, other.org.id, "emailsPerMonth", 5000)).resolves.toBeUndefined();
    });
    await cleanup([other.org.id], other.members.map((m) => m.userId));
  });
});
