import { prisma, type Tx } from "../db";

export class AdminError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface Admin { id: string; email: string }

/**
 * Defence in depth: every admin function re-checks the user in the database (super admin, enabled, 2FA enrolled),
 * so a bug in a page guard or a forgotten check in an action cannot expose platform powers.
 */
export async function assertSuperAdmin(userId: string): Promise<Admin> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || !u.isSuperAdmin || u.disabledAt) throw new AdminError("FORBIDDEN", "Platform administrator access required");
  if (!u.totpEnabledAt) throw new AdminError("MFA_REQUIRED", "Two-factor authentication must be set up for administrator access");
  return { id: u.id, email: u.email };
}

export async function platformAudit(tx: Tx, adminId: string, action: string, entity?: string, entityId?: string, meta: Record<string, unknown> = {}) {
  await tx.platformAudit.create({ data: { actorId: adminId, action, entity, entityId, meta: meta as object } });
}
