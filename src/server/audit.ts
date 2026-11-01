import type { Tx } from "./db";

export interface AuditInput {
  orgId: string;
  actorId?: string | null;
  impersonatorId?: string | null;
  action: string; // e.g. "member.invited", "org.updated"
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
}

/** Writes an audit entry inside the caller's transaction so it commits atomically with the change. */
export async function audit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      orgId: input.orgId,
      actorId: input.actorId ?? null,
      impersonatorId: input.impersonatorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      meta: (input.meta ?? {}) as object,
    },
  });
}

/** Who is acting: the signed-in user, plus the platform admin when this is a support (impersonation) session. */
export const actorOf = (ctx: { userId?: string | null; impersonatorId?: string | null }) => ({ actorId: ctx.userId ?? null, impersonatorId: ctx.impersonatorId ?? null });
