import { Prisma } from "@prisma/client";
import { pageArgs } from "../paginate";
import { sendAuthLink } from "../auth";
import { prisma, withPlatform } from "../db";
import { assertSuperAdmin, AdminError, platformAudit } from "./guard";

export async function listUsers(adminId: string, q: { q?: string; page?: number } = {}) {
  await assertSuperAdmin(adminId);
  const pageSize = 30;
  const where: Prisma.UserWhereInput = q.q ? { OR: [{ email: { contains: q.q, mode: "insensitive" } }, { name: { contains: q.q, mode: "insensitive" } }] } : {};
  return withPlatform(async (tx) => {
    const [users, total] = await Promise.all([
      tx.user.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(q.page, pageSize), include: { memberships: { include: { org: { select: { id: true, name: true, status: true, deletedAt: true } } } } } }),
      tx.user.count({ where }),
    ]);
    return {
      total, pageSize,
      rows: users.map((u) => ({
        id: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin, disabled: !!u.disabledAt, verified: !!u.emailVerifiedAt, twoFactor: !!u.totpEnabledAt, createdAt: u.createdAt,
        orgs: u.memberships.filter((m) => !m.org.deletedAt).map((m) => ({ id: m.org.id, name: m.org.name, role: m.role, status: m.org.status })),
      })),
    };
  });
}

export async function setUserDisabled(adminId: string, userId: string, disabled: boolean) {
  await assertSuperAdmin(adminId);
  if (userId === adminId) throw new AdminError("INVALID", "You cannot disable your own account");
  await withPlatform(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new AdminError("NOT_FOUND", "User not found");
    await tx.user.update({ where: { id: userId }, data: { disabledAt: disabled ? new Date() : null } });
    if (disabled) await tx.session.deleteMany({ where: { OR: [{ userId }, { impersonatorId: userId }] } }); // signed out everywhere, incl. any support sessions they opened
    await platformAudit(tx, adminId, disabled ? "user.disabled" : "user.enabled", "User", userId, { email: u.email });
  });
}

export async function setSuperAdmin(adminId: string, userId: string, on: boolean) {
  await assertSuperAdmin(adminId);
  if (userId === adminId) throw new AdminError("INVALID", "You cannot change your own administrator status");
  await withPlatform(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new AdminError("NOT_FOUND", "User not found");
    if (on && (!u.emailVerifiedAt || u.disabledAt)) throw new AdminError("INVALID", "Only verified, enabled accounts can be made administrators");
    await tx.user.update({ where: { id: userId }, data: { isSuperAdmin: on } });
    if (!on) await tx.session.deleteMany({ where: { impersonatorId: userId } });
    await platformAudit(tx, adminId, on ? "user.promoted_admin" : "user.demoted_admin", "User", userId, { email: u.email });
  });
}

/** For a locked-out user who lost their authenticator. They sign in again (and re-enrol if they are a platform admin). */
export async function resetUserTotp(adminId: string, userId: string) {
  await assertSuperAdmin(adminId);
  if (userId === adminId) throw new AdminError("INVALID", "Reset your own 2FA through another administrator");
  await withPlatform(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw new AdminError("NOT_FOUND", "User not found");
    await tx.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null } });
    await tx.session.deleteMany({ where: { userId } });
    await platformAudit(tx, adminId, "user.totp_reset", "User", userId, { email: u.email });
  });
}

export async function sendUserPasswordReset(adminId: string, userId: string) {
  await assertSuperAdmin(adminId);
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.disabledAt) throw new AdminError("NOT_FOUND", "User not found");
  await sendAuthLink("PASSWORD_RESET", u);
  await withPlatform((tx) => platformAudit(tx, adminId, "user.password_reset_sent", "User", userId, { email: u.email }));
}
