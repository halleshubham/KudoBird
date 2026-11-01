import { randomUUID } from "node:crypto";
import { prisma, withPlatform } from "@/server/db";
import { createOrganization } from "@/server/orgs";
import type { Role } from "@prisma/client";

export async function makeUser(label = "u") {
  return prisma.user.create({ data: { email: `${label}-${randomUUID()}@test.local`, emailVerifiedAt: new Date() } });
}

/** Org with an owner; optionally extra members with given roles. */
export async function makeOrg(extra: Role[] = []) {
  const owner = await makeUser("owner");
  const org = await createOrganization(owner.id, `Test Org ${randomUUID().slice(0, 6)}`);
  const members: { userId: string; role: Role }[] = [{ userId: owner.id, role: "OWNER" }];
  for (const role of extra) {
    const u = await makeUser(role.toLowerCase());
    await withPlatform((tx) => tx.membership.create({ data: { orgId: org.id, userId: u.id, role } }));
    members.push({ userId: u.id, role });
  }
  return { org, owner, members, ctx: (role: Role) => {
    const m = members.find((x) => x.role === role)!;
    return { orgId: org.id, userId: m.userId, role };
  } };
}

export async function cleanup(orgIds: string[], userIds: string[]) {
  await withPlatform(async (tx) => {
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
