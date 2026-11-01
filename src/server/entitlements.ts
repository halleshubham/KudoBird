import type { Plan } from "@prisma/client";
import { prisma, type Tx } from "./db";

/**
 * Central entitlement service. EVERY limited action in the app asks this module
 * ("can this org do X?"). Turning on paid plans is then only a matter of
 * editing Plan rows / org overrides, never application code.
 */

export const LIMIT_KEYS = [
  "campaigns", // total campaigns
  "members", // total members
  "certificatesPerMonth",
  "emailsPerMonth",
  "storageBytes",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = ["customDomain", "whiteLabel", "api", "webhooks", "customEmailSender", "bulkIssue"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

type Limits = Partial<Record<LimitKey, number>>;
type Features = Partial<Record<FeatureKey, boolean>>;

export class EntitlementError extends Error {
  constructor(
    public readonly code: "LIMIT_REACHED" | "FEATURE_UNAVAILABLE",
    public readonly key: string,
    message: string,
  ) {
    super(message);
  }
}

export interface EffectiveEntitlements {
  limits: Limits;
  features: Features;
}

/** Plan values overlaid with per-org overrides ({ limits, features }). -1 = unlimited. */
export function effectiveEntitlements(plan: Pick<Plan, "limits" | "features">, overrides: unknown): EffectiveEntitlements {
  const o = (overrides ?? {}) as { limits?: Limits; features?: Features };
  return {
    limits: { ...(plan.limits as Limits), ...(o.limits ?? {}) },
    features: { ...(plan.features as Features), ...(o.features ?? {}) },
  };
}

export function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

/** Metrics that reset monthly vs. gauges that persist. */
const MONTHLY: Record<string, boolean> = { certificatesPerMonth: true, emailsPerMonth: true };

const METRIC_FOR_LIMIT: Record<LimitKey, string> = {
  campaigns: "campaigns",
  members: "members",
  certificatesPerMonth: "certificates_issued",
  emailsPerMonth: "emails_sent",
  storageBytes: "storage_bytes",
};

export async function loadEntitlements(tx: Tx, orgId: string): Promise<EffectiveEntitlements> {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, include: { plan: true } });
  return effectiveEntitlements(org.plan, org.limitOverrides);
}

export async function getUsage(tx: Tx, orgId: string, key: LimitKey): Promise<number> {
  // Structural counts come from the tables themselves.
  if (key === "members") return tx.membership.count({ where: { orgId } });
  if (key === "campaigns") return tx.campaign.count({ where: { orgId, archivedAt: null } });
  const metric = METRIC_FOR_LIMIT[key];
  return readCounter(tx, orgId, metric, MONTHLY[key] ? currentPeriod() : "total");
}

async function readCounter(tx: Tx, orgId: string, metric: string, period: string): Promise<number> {
  const row = await tx.usageCounter.findUnique({ where: { orgId_metric_period: { orgId, metric, period } } });
  return Number(row?.value ?? 0);
}

/** Throws EntitlementError if adding `amount` would exceed the limit. Call before the action. */
export async function assertWithinLimit(tx: Tx, orgId: string, key: LimitKey, amount = 1): Promise<void> {
  const { limits } = await loadEntitlements(tx, orgId);
  const max = limits[key];
  if (max === undefined || max < 0) return; // undefined or -1 => unlimited
  const used = await getUsage(tx, orgId, key);
  if (used + amount > max) {
    throw new EntitlementError("LIMIT_REACHED", key, `Plan limit reached for ${key} (${used}/${max})`);
  }
}

export async function assertFeature(tx: Tx, orgId: string, feature: FeatureKey): Promise<void> {
  const { features } = await loadEntitlements(tx, orgId);
  if (!features[feature]) {
    throw new EntitlementError("FEATURE_UNAVAILABLE", feature, `Feature "${feature}" is not available on this plan`);
  }
}

/** Increment a usage metric (certificates_issued, emails_sent, storage_bytes). */
export async function recordUsage(tx: Tx, orgId: string, metric: string, amount = 1, period?: string): Promise<void> {
  const p = period ?? (metric === "storage_bytes" || metric === "campaigns" ? "total" : currentPeriod());
  await tx.usageCounter.upsert({
    where: { orgId_metric_period: { orgId, metric, period: p } },
    create: { orgId, metric, period: p, value: BigInt(amount) },
    update: { value: { increment: BigInt(amount) } },
  });
}

/** Generous defaults for the single Free plan used until paid plans are switched on. */
export const FREE_PLAN = {
  key: "free",
  name: "Free",
  limits: { campaigns: -1, members: 25, certificatesPerMonth: -1, emailsPerMonth: 5000, storageBytes: 1_073_741_824 },
  features: { customDomain: false, whiteLabel: false, api: true, webhooks: true, customEmailSender: false, bulkIssue: true },
  isDefault: true,
};

export async function ensureDefaultPlan(tx: Tx = prisma as unknown as Tx): Promise<Plan> {
  return tx.plan.upsert({ where: { key: FREE_PLAN.key }, update: {}, create: FREE_PLAN });
}
