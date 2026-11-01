import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withPlatform, withTenant, withUser } from "@/server/db";
import { audit } from "@/server/audit";
import { recordUsage } from "@/server/entitlements";
import { listUserOrgs } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

let A: Awaited<ReturnType<typeof makeOrg>>;
let B: Awaited<ReturnType<typeof makeOrg>>;

beforeAll(async () => {
  A = await makeOrg(["VIEWER"]);
  B = await makeOrg();
  for (const o of [A, B]) {
    await withTenant({ orgId: o.org.id, userId: o.owner.id }, async (tx) => {
      await audit(tx, { orgId: o.org.id, actorId: o.owner.id, action: "test.event" });
      await recordUsage(tx, o.org.id, "certificates_issued", 3);
      await tx.invite.create({ data: { orgId: o.org.id, email: "x@y.z", role: "VIEWER", tokenHash: "h" + o.org.id, invitedById: o.owner.id, expiresAt: new Date(Date.now() + 1e6) } });
    });
  }
});

afterAll(async () => {
  await cleanup([A.org.id, B.org.id], [...A.members, ...B.members].map((m) => m.userId));
  await prisma.$disconnect();
});

const asA = () => ({ orgId: A.org.id, userId: A.owner.id });

describe("tenant isolation (Postgres RLS, connected as restricted app role)", () => {
  it("app connects as a role that is neither superuser nor BYPASSRLS", async () => {
    const [r] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r.rolsuper).toBe(false);
    expect(r.rolbypassrls).toBe(false);
  });

  it("org A only sees its own rows in every tenant table", async () => {
    await withTenant(asA(), async (tx) => {
      expect((await tx.organization.findMany()).map((o) => o.id)).toEqual([A.org.id]);
      expect((await tx.membership.findMany()).every((m) => m.orgId === A.org.id)).toBe(true);
      expect((await tx.invite.findMany()).every((i) => i.orgId === A.org.id)).toBe(true);
      expect((await tx.auditLog.findMany()).every((l) => l.orgId === A.org.id)).toBe(true);
      expect((await tx.usageCounter.findMany()).every((u) => u.orgId === A.org.id)).toBe(true);
      expect((await tx.subscription.findMany()).every((s) => s.orgId === A.org.id)).toBe(true);
    });
  });

  it("direct lookup of another org's rows by id returns nothing", async () => {
    await withTenant(asA(), async (tx) => {
      expect(await tx.organization.findUnique({ where: { id: B.org.id } })).toBeNull();
      expect(await tx.membership.findFirst({ where: { orgId: B.org.id } })).toBeNull();
      expect(await tx.auditLog.findFirst({ where: { orgId: B.org.id } })).toBeNull();
    });
  });

  it("raw SQL cannot escape the policy either", async () => {
    await withTenant(asA(), async (tx) => {
      const rows = await tx.$queryRaw<{ orgId: string }[]>`SELECT "orgId" FROM "AuditLog" WHERE "orgId" = ${B.org.id}::uuid`;
      expect(rows).toHaveLength(0);
      const all = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "UsageCounter"`;
      expect(Number(all[0].n)).toBe(1);
    });
  });

  it("cannot insert a row into another org", async () => {
    await expect(
      withTenant(asA(), (tx) => tx.auditLog.create({ data: { orgId: B.org.id, action: "evil" } })),
    ).rejects.toThrow();
    await expect(
      withTenant(asA(), (tx) => tx.membership.create({ data: { orgId: B.org.id, userId: A.owner.id, role: "OWNER" } })),
    ).rejects.toThrow();
  });

  it("cannot update or delete another org's rows", async () => {
    await withTenant(asA(), async (tx) => {
      expect((await tx.organization.updateMany({ where: { id: B.org.id }, data: { name: "pwned" } })).count).toBe(0);
      expect((await tx.membership.deleteMany({ where: { orgId: B.org.id } })).count).toBe(0);
      expect((await tx.invite.deleteMany({ where: { orgId: B.org.id } })).count).toBe(0);
    });
    const still = await withPlatform((tx) => tx.organization.findUniqueOrThrow({ where: { id: B.org.id } }));
    expect(still.name).not.toBe("pwned");
  });

  it("cannot move a row to another org by updating orgId", async () => {
    await expect(
      withTenant(asA(), (tx) => tx.auditLog.updateMany({ where: {}, data: { orgId: B.org.id } })),
    ).rejects.toThrow();
  });

  it("without any context nothing is visible", async () => {
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("a user sees only the orgs they belong to (org switcher)", async () => {
    const orgs = await listUserOrgs(A.owner.id);
    expect(orgs.map((o) => o.org.id)).toEqual([A.org.id]);
    // A user context cannot read other members' memberships in unrelated orgs
    await withUser(A.owner.id, async (tx) => {
      expect(await tx.membership.findMany({ where: { orgId: B.org.id } })).toHaveLength(0);
    });
  });

  it("one user in two orgs sees both, each scoped separately", async () => {
    await withPlatform((tx) => tx.membership.create({ data: { orgId: B.org.id, userId: A.owner.id, role: "VIEWER" } }));
    const orgs = await listUserOrgs(A.owner.id);
    expect(orgs.map((o) => o.org.id).sort()).toEqual([A.org.id, B.org.id].sort());
    await withTenant({ orgId: B.org.id, userId: A.owner.id }, async (tx) => {
      expect((await tx.auditLog.findMany()).every((l) => l.orgId === B.org.id)).toBe(true);
    });
    await withPlatform((tx) => tx.membership.deleteMany({ where: { orgId: B.org.id, userId: A.owner.id } }));
  });

  it("tenant context does not leak between transactions on pooled connections", async () => {
    await withTenant(asA(), async () => {});
    // Run many quick queries without context; none may see A's data.
    const counts = await Promise.all(Array.from({ length: 10 }, () => prisma.auditLog.count()));
    expect(counts.every((c) => c === 0)).toBe(true);
  });

  it("platform scope (super admin / workers) sees every org", async () => {
    const ids = await withPlatform(async (tx) => (await tx.organization.findMany({ where: { id: { in: [A.org.id, B.org.id] } } })).length);
    expect(ids).toBe(2);
  });
});
