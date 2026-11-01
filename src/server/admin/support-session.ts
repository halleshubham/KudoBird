import { audit } from "../audit";
import { destroySession } from "../auth";
import { hashToken } from "../crypto";
import { prisma, withPlatform, withTenant } from "../db";
import type { OrgContext } from "../orgs";
import { assertCan } from "../permissions";
import { platformAudit } from "./guard";

export const IMPERSONATION_MINUTES = 60;

/** Ends a support session: closes the log, writes the org audit entry and destroys the session. */
export async function stopImpersonation(sessionToken: string) {
  const s = await prisma.session.findUnique({ where: { tokenHash: hashToken(sessionToken) }, include: { user: true } });
  if (!s?.impersonatorId) return null;
  await withPlatform(async (tx) => {
    const open = await tx.impersonationLog.findFirst({ where: { adminId: s.impersonatorId!, targetUserId: s.userId, endedAt: null }, orderBy: { startedAt: "desc" } });
    if (open) {
      await tx.impersonationLog.update({ where: { id: open.id }, data: { endedAt: new Date() } });
      await audit(tx, { orgId: open.orgId, actorId: s.impersonatorId, action: "support.access_ended", entity: "User", entityId: s.userId, meta: { admin: open.adminEmail } });
      await platformAudit(tx, s.impersonatorId!, "impersonation.ended", "User", s.userId, { orgId: open.orgId });
    }
  });
  await destroySession(sessionToken);
  return { adminId: s.impersonatorId };
}

/** What the organisation itself can see about support access. */
export async function listSupportAccess(ctx: OrgContext) {
  assertCan(ctx.role, "audit.view");
  const rows = await withTenant(ctx, (tx) => tx.impersonationLog.findMany({ where: { orgId: ctx.orgId }, orderBy: { startedAt: "desc" }, take: 20 }));
  const cutoff = Date.now() - IMPERSONATION_MINUTES * 60_000;
  return rows.map((r) => ({ ...r, state: r.endedAt ? ("ended" as const) : r.startedAt.getTime() < cutoff ? ("expired" as const) : ("active" as const) }));
}
