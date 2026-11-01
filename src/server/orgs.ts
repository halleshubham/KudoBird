import { randomUUID } from "node:crypto";
import { Prisma, type Role } from "@prisma/client";
import * as React from "react";
import { audit } from "./audit";
import { hashToken, newToken } from "./crypto";
import { prisma, withPlatform, withTenant, withUser, type TenantContext } from "./db";
import { sendEmail } from "./email";
import { ActionEmail } from "./email/templates";
import { assertWithinLimit, ensureDefaultPlan } from "./entitlements";
import { env } from "./env";
import { assertCan, canManageRole, ForbiddenError } from "./permissions";
import { slugify } from "./slug";
import { normalizeEmail } from "./auth";

export interface OrgContext extends TenantContext {
  userId: string;
  role: Role;
  /** Set when a super admin is acting as this user. */
  impersonatorId?: string | null;
}

export class OrgError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/** Creates an organisation on the default plan and makes `userId` its owner. */
export async function createOrganization(userId: string, name: string) {
  const orgId = randomUUID();
  const base = slugify(name);
  const plan = await withPlatform((tx) => ensureDefaultPlan(tx));
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
    try {
      // The new org id is set as the tenant context so RLS WITH CHECK accepts the inserts.
      return await withTenant({ orgId, userId }, async (tx) => {
        const org = await tx.organization.create({ data: { id: orgId, name: name.trim(), slug, planId: plan.id } });
        await tx.membership.create({ data: { orgId, userId, role: "OWNER" } });
        await tx.subscription.create({ data: { orgId, planId: plan.id } });
        await audit(tx, { orgId, actorId: userId, action: "org.created", entity: "Organization", entityId: orgId });
        return org;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // slug taken
      throw e;
    }
  }
  throw new OrgError("SLUG_TAKEN", "Could not allocate a unique organisation address");
}

export async function listUserOrgs(userId: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx.membership.findMany({ where: { userId }, include: { org: true }, orderBy: { createdAt: "asc" } });
    return rows.filter((m) => !m.org.deletedAt).map((m) => ({ org: m.org, role: m.role }));
  });
}

/** Resolves the caller's role in an org, or null if not a member / org suspended. */
export async function resolveOrgContext(userId: string, orgId: string, impersonatorId?: string | null): Promise<OrgContext | null> {
  return withUser(userId, async (tx) => {
    const m = await tx.membership.findUnique({ where: { orgId_userId: { orgId, userId } }, include: { org: true } });
    if (!m || m.org.deletedAt || m.org.status === "SUSPENDED") return null;
    return { orgId, userId, role: m.role, impersonatorId };
  });
}

const actor = (ctx: OrgContext) => ({ actorId: ctx.userId, impersonatorId: ctx.impersonatorId });

export async function updateOrganization(ctx: OrgContext, data: { name?: string; primaryColor?: string | null; logoAssetId?: string | null }) {
  assertCan(ctx.role, "org.update");
  return withTenant(ctx, async (tx) => {
    if (data.logoAssetId) {
      const a = await tx.asset.findFirst({ where: { id: data.logoAssetId, orgId: ctx.orgId, kind: "LOGO" } });
      if (!a) throw new OrgError("NOT_FOUND", "Logo not found");
    }
    const org = await tx.organization.update({ where: { id: ctx.orgId }, data });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "org.updated", entity: "Organization", entityId: ctx.orgId, meta: data });
    return org;
  });
}

// ---------------------------------------------------------------- members & invites

export async function listMembers(ctx: OrgContext) {
  assertCan(ctx.role, "members.view");
  return withTenant(ctx, async (tx) => {
    const members = await tx.membership.findMany({ where: { orgId: ctx.orgId }, include: { user: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: "asc" } });
    const invites = await tx.invite.findMany({ where: { orgId: ctx.orgId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    return { members, invites };
  });
}

export async function inviteMember(ctx: OrgContext, emailRaw: string, role: Role) {
  assertCan(ctx.role, "members.manage");
  if (!canManageRole(ctx.role, role)) throw new ForbiddenError("members.manage_owner");
  const email = normalizeEmail(emailRaw);
  const { token, hash } = newToken();
  const { orgName } = await withTenant(ctx, async (tx) => {
    await assertWithinLimit(tx, ctx.orgId, "members");
    const existing = await tx.membership.findFirst({ where: { orgId: ctx.orgId, user: { email } } });
    if (existing) throw new OrgError("ALREADY_MEMBER", "This person is already a member");
    // Re-inviting replaces any pending invite for the same email.
    await tx.invite.deleteMany({ where: { orgId: ctx.orgId, email, acceptedAt: null } });
    const invite = await tx.invite.create({
      data: { orgId: ctx.orgId, email, role, tokenHash: hash, invitedById: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "member.invited", entity: "Invite", entityId: invite.id, meta: { email, role } });
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    return { orgName: org.name };
  });
  const url = new URL("/invite/accept", env().APP_URL);
  url.searchParams.set("token", token);
  await sendEmail({
    to: email,
    subject: `You're invited to ${orgName} on KudoBird`,
    react: React.createElement(ActionEmail, {
      preview: `Join ${orgName}`,
      heading: `Join ${orgName}`,
      body: `You have been invited to join ${orgName} as ${role.toLowerCase()}.`,
      actionLabel: "Accept invitation",
      actionUrl: url.toString(),
    }),
  });
  return { token }; // token returned for tests/dev; never exposed through the API layer
}

/** The invite token is the capability; the signed-in user's verified email must match the invite. */
export async function acceptInvite(token: string, user: { id: string; email: string; emailVerifiedAt: Date | null }) {
  return withPlatform(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new OrgError("INVALID_INVITE", "This invitation is invalid or has expired");
    if (invite.email !== normalizeEmail(user.email) || !user.emailVerifiedAt) {
      throw new OrgError("EMAIL_MISMATCH", "Sign in with the email address that was invited (and verify it)");
    }
    await assertWithinLimit(tx, invite.orgId, "members");
    await tx.membership.upsert({
      where: { orgId_userId: { orgId: invite.orgId, userId: user.id } },
      create: { orgId: invite.orgId, userId: user.id, role: invite.role },
      update: {},
    });
    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    await audit(tx, { orgId: invite.orgId, actorId: user.id, action: "member.joined", entity: "Invite", entityId: invite.id, meta: { role: invite.role } });
    return { orgId: invite.orgId };
  });
}

export async function revokeInvite(ctx: OrgContext, inviteId: string) {
  assertCan(ctx.role, "members.manage");
  await withTenant(ctx, async (tx) => {
    await tx.invite.deleteMany({ where: { id: inviteId, orgId: ctx.orgId } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "invite.revoked", entity: "Invite", entityId: inviteId });
  });
}

async function ownerCount(tx: Prisma.TransactionClient, orgId: string) {
  return tx.membership.count({ where: { orgId, role: "OWNER" } });
}

export async function changeMemberRole(ctx: OrgContext, memberUserId: string, newRole: Role) {
  assertCan(ctx.role, "members.manage");
  return withTenant(ctx, async (tx) => {
    const target = await tx.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: memberUserId } } });
    if (!target) throw new OrgError("NOT_FOUND", "Member not found");
    if (!canManageRole(ctx.role, target.role) || !canManageRole(ctx.role, newRole)) throw new ForbiddenError("members.manage_owner");
    if (target.role === "OWNER" && newRole !== "OWNER" && (await ownerCount(tx, ctx.orgId)) <= 1) {
      throw new OrgError("LAST_OWNER", "An organisation must keep at least one owner");
    }
    const updated = await tx.membership.update({ where: { id: target.id }, data: { role: newRole } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "member.role_changed", entity: "Membership", entityId: target.id, meta: { from: target.role, to: newRole } });
    return updated;
  });
}

/** Removes a member; members may also remove themselves (leave). */
export async function removeMember(ctx: OrgContext, memberUserId: string) {
  const leaving = memberUserId === ctx.userId;
  if (!leaving) assertCan(ctx.role, "members.manage");
  await withTenant(ctx, async (tx) => {
    const target = await tx.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: memberUserId } } });
    if (!target) throw new OrgError("NOT_FOUND", "Member not found");
    if (!leaving && !canManageRole(ctx.role, target.role)) throw new ForbiddenError("members.manage_owner");
    if (target.role === "OWNER" && (await ownerCount(tx, ctx.orgId)) <= 1) throw new OrgError("LAST_OWNER", "An organisation must keep at least one owner");
    await tx.membership.delete({ where: { id: target.id } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: leaving ? "member.left" : "member.removed", entity: "Membership", entityId: target.id });
  });
  await prisma.session.updateMany({ where: { userId: memberUserId, activeOrgId: ctx.orgId }, data: { activeOrgId: null } });
}

export async function listAuditLog(ctx: OrgContext, take = 100) {
  assertCan(ctx.role, "audit.view");
  return withTenant(ctx, (tx) => tx.auditLog.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" }, take }));
}

export interface AuditQuery { action?: string; actorId?: string; page?: number; pageSize?: number }

/** Paged, filterable audit log with actor emails resolved. Visible to owners and admins only. */
export async function queryAuditLog(ctx: OrgContext, q: AuditQuery = {}) {
  assertCan(ctx.role, "audit.view");
  const pageSize = Math.min(q.pageSize ?? 50, 200);
  const where: Prisma.AuditLogWhereInput = { orgId: ctx.orgId, ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.actorId ? { actorId: q.actorId } : {}) };
  const { rows, total, actions } = await withTenant(ctx, async (tx) => {
    const [rows, total, actions] = await Promise.all([
      tx.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: ((q.page ?? 1) - 1) * pageSize, take: pageSize }),
      tx.auditLog.count({ where }),
      tx.auditLog.groupBy({ by: ["action"], where: { orgId: ctx.orgId }, _count: true }),
    ]);
    return { rows, total, actions: actions.map((a) => a.action).sort() };
  });
  const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.impersonatorId]).filter(Boolean) as string[])];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  const email = (id: string | null) => (id ? users.find((u) => u.id === id)?.email ?? "unknown" : null);
  return { total, pageSize, actions, rows: rows.map((r) => ({ ...r, actorEmail: email(r.actorId), impersonatorEmail: email(r.impersonatorId) })) };
}
