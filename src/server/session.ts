import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { createSession, destroySession, getSession } from "./auth";
import { prisma } from "./db";
import { listUserOrgs, resolveOrgContext, type OrgContext } from "./orgs";
import { can, type Permission } from "./permissions";

const COOKIE = "kb_session";

export async function setSessionCookie(userId: string, opts: Parameters<typeof createSession>[1] = {}) {
  const { token, expiresAt } = await createSession(userId, opts);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) await destroySession(t);
  jar.delete(COOKIE);
}

export async function currentSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  return getSession(token);
}

/** Signed-in, MFA-satisfied user or redirect. */
export async function requireUser() {
  const session = await currentSession();
  if (!session) redirect("/login");
  const needsMfa = session.user.isSuperAdmin || !!session.user.totpEnabledAt;
  if (needsMfa && !session.mfaVerified) redirect("/2fa");
  return { user: session.user, session };
}

export interface AppContext {
  user: Awaited<ReturnType<typeof requireUser>>["user"];
  session: NonNullable<Awaited<ReturnType<typeof currentSession>>>;
  ctx: OrgContext;
  orgs: Awaited<ReturnType<typeof listUserOrgs>>;
  role: Role;
}

/** Resolves the active org from the session; sends the user to onboarding if they have none. */
export async function requireOrg(permission?: Permission): Promise<AppContext> {
  const { user, session } = await requireUser();
  const orgs = await listUserOrgs(user.id);
  if (orgs.length === 0) redirect("/onboarding");
  let orgId = session.activeOrgId;
  if (!orgId || !orgs.some((o) => o.org.id === orgId)) {
    orgId = orgs[0].org.id;
    await prisma.session.update({ where: { id: session.id }, data: { activeOrgId: orgId } });
  }
  const ctx = await resolveOrgContext(user.id, orgId, session.impersonatorId);
  if (!ctx) redirect("/onboarding");
  if (permission && !can(ctx.role, permission)) redirect("/app?forbidden=1");
  return { user, session, ctx, orgs, role: ctx.role };
}
