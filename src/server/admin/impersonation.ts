import * as React from "react";
import { audit } from "../audit";
import { createSession, destroySession } from "../auth";
import { hashToken } from "../crypto";
import { prisma, withPlatform, withTenant } from "../db";
import { deliver } from "../email/notifications";
import { ActionEmail } from "../email/templates";
import { env } from "../env";
import { assertCan } from "../permissions";
import type { OrgContext } from "../orgs";
import { assertSuperAdmin, AdminError, platformAudit } from "./guard";

export const IMPERSONATION_MINUTES = 60;

/**
 * Support access: platform staff act as an org user. Safeguards:
 *  - a written reason is mandatory and stored
 *  - cannot target another platform admin, a disabled user, a non-member, or a suspended/deleted org
 *  - the session expires after 60 minutes and is pinned to this one organisation (see requireOrg)
 *  - every start/stop is in the org's own audit log AND a support-access log the org can read; org owners are emailed
 *  - actions done during the session are audit-logged with the admin recorded as `impersonatorId`
 */
export async function startImpersonation(adminId: string, input: { orgId: string; userId: string; reason: string }) {
  const admin = await assertSuperAdmin(adminId);
  const reason = input.reason.trim();
  if (reason.length < 10) throw new AdminError("REASON_REQUIRED", "Give a reason of at least 10 characters (for example the support ticket)");
  const { target, org, owners } = await withPlatform(async (tx) => {
    const m = await tx.membership.findUnique({ where: { orgId_userId: { orgId: input.orgId, userId: input.userId } }, include: { user: true, org: true } });
    if (!m) throw new AdminError("NOT_MEMBER", "That user is not a member of this organisation");
    if (m.user.isSuperAdmin) throw new AdminError("FORBIDDEN", "Platform administrators cannot be impersonated");
    if (m.user.disabledAt) throw new AdminError("DISABLED", "This user is disabled");
    if (m.org.deletedAt || m.org.status !== "ACTIVE") throw new AdminError("ORG_INACTIVE", "Reactivate the organisation before using support access");
    const owners = await tx.membership.findMany({ where: { orgId: input.orgId, role: "OWNER" }, include: { user: true } });
    await tx.impersonationLog.create({ data: { orgId: input.orgId, adminId: admin.id, adminEmail: admin.email, targetUserId: m.userId, targetEmail: m.user.email, reason } });
    await audit(tx, { orgId: input.orgId, actorId: admin.id, action: "support.access_started", entity: "User", entityId: m.userId, meta: { admin: admin.email, as: m.user.email, reason } });
    await platformAudit(tx, admin.id, "impersonation.started", "User", m.userId, { orgId: input.orgId, reason });
    return { target: m.user, org: m.org, owners };
  });
  const session = await createSession(target.id, { activeOrgId: input.orgId, mfaVerified: true, impersonatorId: admin.id, days: IMPERSONATION_MINUTES / 1440 });
  // The org is told, not just logged: every owner gets an email.
  for (const o of owners) {
    await deliver({
      orgId: input.orgId, kind: "SUPPORT_ACCESS", to: o.user.email, contributor: false, subject: `KudoBird support accessed ${org.name}`,
      react: React.createElement(ActionEmail, {
        preview: "Support access to your workspace", heading: "Support access to your workspace",
        body: `A KudoBird platform administrator (${admin.email}) signed in to ${org.name} as ${target.email} for up to ${IMPERSONATION_MINUTES} minutes. Reason: ${reason}. This is recorded in your audit log.`,
        actionLabel: "Review audit log", actionUrl: new URL("/app/audit", env().APP_URL).toString(), footer: "If you did not request support, contact us.",
      }),
    }).catch((e) => console.error("[support] owner notice failed", e instanceof Error ? e.message : e));
  }
  return { ...session, orgId: input.orgId, targetEmail: target.email };
}

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
