import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Raw client. Connects as the restricted app role, so RLS applies to every query. */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

export interface TenantContext {
  orgId: string;
  userId?: string;
}

async function setContext(tx: Tx, ctx: { orgId?: string; userId?: string; bypass?: boolean }) {
  // set_config(..., true) is transaction-local, so context can never leak
  // between requests sharing a pooled connection.
  await tx.$executeRaw`SELECT
    set_config('app.org_id', ${ctx.orgId ?? ""}, true),
    set_config('app.user_id', ${ctx.userId ?? ""}, true),
    set_config('app.bypass', ${ctx.bypass ? "on" : ""}, true)`;
}

/**
 * Runs `fn` inside a transaction scoped to one organisation. Postgres RLS
 * guarantees queries inside can only see or write that org's rows.
 * All tenant data access in the app must go through this function.
 */
export function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.orgId) throw new Error("withTenant requires an orgId");
  return prisma.$transaction(async (tx) => {
    await setContext(tx, ctx);
    return fn(tx);
  });
}

/** Scope for reading what a user can see across orgs (org switcher). No org selected. */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setContext(tx, { userId });
    return fn(tx);
  });
}

/**
 * Bypasses tenant isolation. Only for: super admin panel, background workers,
 * public pages that resolve their org from a public id, signup. Keep call sites few and audited.
 */
export function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setContext(tx, { bypass: true });
    return fn(tx);
  });
}
