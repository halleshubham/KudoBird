import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import * as React from "react";
import { audit } from "../audit";
import { hashToken, newToken } from "../crypto";
import { withPlatform } from "../db";
import { sendEmail } from "../email";
import { ActionEmail } from "../email/templates";
import { currentPeriod, FEATURE_KEYS, LIMIT_KEYS, defaultPlanFor } from "../entitlements";
import { env } from "../env";
import { slugify } from "../slug";
import { getStorage } from "../storage";
import { assertSuperAdmin, AdminError, platformAudit } from "./guard";
import { normalizeEmail } from "../auth";

export async function listOrgs(adminId: string, q: { q?: string; status?: "ACTIVE" | "SUSPENDED" | "DELETED"; page?: number } = {}) {
  await assertSuperAdmin(adminId);
  const pageSize = 25;
  const where: Prisma.OrganizationWhereInput = {
    ...(q.status === "DELETED" ? { deletedAt: { not: null } } : { deletedAt: null, ...(q.status ? { status: q.status } : {}) }),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { slug: { contains: q.q, mode: "insensitive" } }] } : {}),
  };
  return withPlatform(async (tx) => {
    const [orgs, total] = await Promise.all([
      tx.organization.findMany({ where, orderBy: { createdAt: "desc" }, skip: ((q.page ?? 1) - 1) * pageSize, take: pageSize, include: { plan: { select: { name: true, key: true } } } }),
      tx.organization.count({ where }),
    ]);
    const ids = orgs.map((o) => o.id);
    const [members, campaigns, certs, usage] = await Promise.all([
      tx.membership.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _count: true }),
      tx.campaign.groupBy({ by: ["orgId"], where: { orgId: { in: ids }, archivedAt: null }, _count: true }),
      tx.certificate.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _count: true }),
      tx.usageCounter.findMany({ where: { orgId: { in: ids }, OR: [{ metric: "storage_bytes" }, { period: currentPeriod() }] } }),
    ]);
    const n = (rows: { orgId: string; _count: number }[], id: string) => rows.find((r) => r.orgId === id)?._count ?? 0;
    return {
      total, pageSize,
      rows: orgs.map((o) => ({
        id: o.id, name: o.name, slug: o.slug, status: o.status, deletedAt: o.deletedAt, createdAt: o.createdAt, plan: o.plan,
        members: n(members, o.id), campaigns: n(campaigns, o.id), certificates: n(certs, o.id),
        certificatesThisMonth: Number(usage.find((u) => u.orgId === o.id && u.metric === "certificates_issued")?.value ?? 0),
        storageBytes: Number(usage.find((u) => u.orgId === o.id && u.metric === "storage_bytes")?.value ?? 0),
      })),
    };
  });
}

export async function getOrgDetail(adminId: string, orgId: string) {
  await assertSuperAdmin(adminId);
  return withPlatform(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId }, include: { plan: true } });
    if (!org) throw new AdminError("NOT_FOUND", "Organisation not found");
    const [members, usage, campaigns, impersonations, plans, audit] = await Promise.all([
      tx.membership.findMany({ where: { orgId }, include: { user: { select: { id: true, email: true, name: true, disabledAt: true, isSuperAdmin: true } } }, orderBy: { createdAt: "asc" } }),
      tx.usageCounter.findMany({ where: { orgId, OR: [{ metric: "storage_bytes" }, { period: currentPeriod() }] } }),
      tx.campaign.count({ where: { orgId, archivedAt: null } }),
      tx.impersonationLog.findMany({ where: { orgId }, orderBy: { startedAt: "desc" }, take: 10 }),
      tx.plan.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      tx.auditLog.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 15 }),
    ]);
    return { org, members, usage: Object.fromEntries(usage.map((u) => [u.metric, Number(u.value)])), campaigns, impersonations, plans, audit };
  });
}

const plainOwnerInvite = (orgName: string, url: string) =>
  React.createElement(ActionEmail, { preview: `Your ${orgName} workspace is ready`, heading: `Your workspace "${orgName}" is ready`, body: `A KudoBird workspace has been created for you as owner. Accept to sign in and start.`, actionLabel: "Accept and open workspace", actionUrl: url });

/** Creates an organisation for someone else. An existing account becomes owner immediately; otherwise an owner invitation is emailed. */
export async function createOrgForOwner(adminId: string, input: { name: string; ownerEmail: string; planKey?: string }) {
  await assertSuperAdmin(adminId);
  const name = input.name.trim();
  if (name.length < 2) throw new AdminError("INVALID", "Organisation name is required");
  const email = normalizeEmail(input.ownerEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new AdminError("INVALID", "A valid owner email is required");
  const orgId = randomUUID();
  const base = slugify(name);
  let invite: { token: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
    try {
      const org = await withPlatform(async (tx) => {
        const plan = input.planKey ? await tx.plan.findFirst({ where: { key: input.planKey, active: true } }) : await defaultPlanFor(tx);
        if (!plan) throw new AdminError("NOT_FOUND", "Plan not found");
        const o = await tx.organization.create({ data: { id: orgId, name, slug, planId: plan.id } });
        await tx.subscription.create({ data: { orgId, planId: plan.id } });
        const owner = await tx.user.findUnique({ where: { email } });
        if (owner) await tx.membership.create({ data: { orgId, userId: owner.id, role: "OWNER" } });
        else {
          const t = newToken();
          await tx.invite.create({ data: { orgId, email, role: "OWNER", tokenHash: hashToken(t.token), invitedById: adminId, expiresAt: new Date(Date.now() + 14 * 86_400_000) } });
          invite = { token: t.token };
        }
        await audit(tx, { orgId, actorId: adminId, action: "org.created_by_platform", entity: "Organization", entityId: orgId, meta: { owner: email } });
        await platformAudit(tx, adminId, "org.created", "Organization", orgId, { name, owner: email, plan: plan.key });
        return o;
      });
      if (invite) {
        const url = new URL("/invite/accept", env().APP_URL);
        url.searchParams.set("token", (invite as { token: string }).token);
        await sendEmail({ to: email, subject: `Your ${name} workspace on KudoBird`, react: plainOwnerInvite(name, url.toString()) });
      }
      return { org, invited: !!invite };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new AdminError("SLUG_TAKEN", "Could not allocate a unique address");
}

export async function setOrgPlan(adminId: string, orgId: string, planKey: string) {
  await assertSuperAdmin(adminId);
  return withPlatform(async (tx) => {
    const [org, plan] = await Promise.all([tx.organization.findUnique({ where: { id: orgId } }), tx.plan.findFirst({ where: { key: planKey, active: true } })]);
    if (!org) throw new AdminError("NOT_FOUND", "Organisation not found");
    if (!plan) throw new AdminError("NOT_FOUND", "Plan not found");
    await tx.organization.update({ where: { id: orgId }, data: { planId: plan.id } });
    await tx.subscription.updateMany({ where: { orgId, status: "ACTIVE" }, data: { status: "CANCELED" } });
    await tx.subscription.create({ data: { orgId, planId: plan.id } });
    await audit(tx, { orgId, actorId: adminId, action: "plan.changed", entity: "Organization", entityId: orgId, meta: { plan: plan.key } });
    await platformAudit(tx, adminId, "org.plan_changed", "Organization", orgId, { plan: plan.key });
  });
}

export interface Overrides { limits?: Record<string, number | null>; features?: Record<string, boolean | null> }

/** Per-org limit and feature overrides on top of the plan. `null` removes an override (falls back to the plan). */
export async function setOrgOverrides(adminId: string, orgId: string, input: Overrides) {
  await assertSuperAdmin(adminId);
  const limits: Record<string, number> = {};
  const features: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input.limits ?? {})) {
    if (!(LIMIT_KEYS as readonly string[]).includes(k)) throw new AdminError("INVALID", `Unknown limit "${k}"`);
    if (v === null) continue;
    if (!Number.isFinite(v) || (v < 0 && v !== -1)) throw new AdminError("INVALID", `Limit "${k}" must be a number >= 0, or -1 for unlimited`);
    limits[k] = Math.floor(v);
  }
  for (const [k, v] of Object.entries(input.features ?? {})) {
    if (!(FEATURE_KEYS as readonly string[]).includes(k)) throw new AdminError("INVALID", `Unknown feature "${k}"`);
    if (v !== null) features[k] = !!v;
  }
  const value = { limits, features };
  await withPlatform(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new AdminError("NOT_FOUND", "Organisation not found");
    await tx.organization.update({ where: { id: orgId }, data: { limitOverrides: value } });
    await audit(tx, { orgId, actorId: adminId, action: "limits.changed", entity: "Organization", entityId: orgId, meta: value });
    await platformAudit(tx, adminId, "org.overrides_changed", "Organization", orgId, value);
  });
}

export async function setOrgStatus(adminId: string, orgId: string, status: "ACTIVE" | "SUSPENDED", reason?: string) {
  await assertSuperAdmin(adminId);
  await withPlatform(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org || org.deletedAt) throw new AdminError("NOT_FOUND", "Organisation not found");
    await tx.organization.update({ where: { id: orgId }, data: { status } });
    // Members of a suspended org must not keep working through existing sessions; they land on the "suspended" page.
    await audit(tx, { orgId, actorId: adminId, action: status === "SUSPENDED" ? "org.suspended" : "org.unsuspended", entity: "Organization", entityId: orgId, meta: { reason } });
    await platformAudit(tx, adminId, status === "SUSPENDED" ? "org.suspended" : "org.unsuspended", "Organization", orgId, { reason });
  });
}

/** Soft delete: hidden everywhere and non-functional, but recoverable until purged. */
export async function softDeleteOrg(adminId: string, orgId: string) {
  await assertSuperAdmin(adminId);
  await withPlatform(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new AdminError("NOT_FOUND", "Organisation not found");
    await tx.organization.update({ where: { id: orgId }, data: { deletedAt: new Date(), status: "SUSPENDED" } });
    await tx.session.updateMany({ where: { activeOrgId: orgId }, data: { activeOrgId: null } });
    await platformAudit(tx, adminId, "org.deleted", "Organization", orgId, { name: org.name, slug: org.slug });
  });
}

export async function restoreOrg(adminId: string, orgId: string) {
  await assertSuperAdmin(adminId);
  await withPlatform(async (tx) => {
    await tx.organization.update({ where: { id: orgId }, data: { deletedAt: null, status: "ACTIVE" } });
    await platformAudit(tx, adminId, "org.restored", "Organization", orgId);
  });
}

/** Irreversible: removes the organisation, all its data and its stored files. Requires typing the org's slug. */
export async function purgeOrg(adminId: string, orgId: string, confirmSlug: string) {
  await assertSuperAdmin(adminId);
  const { keys, org } = await withPlatform(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new AdminError("NOT_FOUND", "Organisation not found");
    if (!org.deletedAt) throw new AdminError("NOT_DELETED", "Delete the organisation first, then purge it");
    if (confirmSlug.trim() !== org.slug) throw new AdminError("CONFIRMATION_MISMATCH", "Type the organisation's address exactly to confirm");
    const [assets, certs] = await Promise.all([tx.asset.findMany({ where: { orgId }, select: { storageKey: true } }), tx.certificate.findMany({ where: { orgId }, select: { outputs: true } })]);
    const keys = [...assets.map((a) => a.storageKey), ...certs.flatMap((c) => Object.values(c.outputs as Record<string, { key: string }>).map((o) => o.key))];
    await tx.session.updateMany({ where: { activeOrgId: orgId }, data: { activeOrgId: null } });
    await tx.organization.delete({ where: { id: orgId } }); // cascades to every tenant table
    await platformAudit(tx, adminId, "org.purged", "Organization", orgId, { name: org.name, slug: org.slug, files: keys.length });
    return { keys, org };
  });
  await Promise.all(keys.map((k) => getStorage().delete(k).catch(() => {})));
  return { purgedFiles: keys.length, slug: org.slug };
}


