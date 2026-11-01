"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  AuthError, beginTotpSetup, confirmTotpSetup, loginWithPassword, registerUser, requestMagicLink, requestPasswordReset,
  resetPassword, verifyTotp,
} from "@/server/auth";
import { prisma } from "@/server/db";
import { createOrganization, OrgError } from "@/server/orgs";
import { clearSessionCookie, currentSession, requireOrg, requireUser, setSessionCookie } from "@/server/session";

type State = { error?: string; info?: string } | undefined;
const fail = (e: unknown): State => {
  if (e instanceof AuthError || e instanceof OrgError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Invalid input" };
  if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
  console.error(e);
  return { error: "Something went wrong" };
};
const safeNext = (n: FormDataEntryValue | null) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/app");

export async function loginAction(_: State, fd: FormData): Promise<State> {
  try {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(Object.fromEntries(fd));
    const user = await loginWithPassword(email, password);
    await setSessionCookie(user.id);
    redirect(safeNext(fd.get("next")));
  } catch (e) { return fail(e); }
}

export async function signupAction(_: State, fd: FormData): Promise<State> {
  try {
    const { email, password, name } = z.object({ email: z.string().email(), password: z.string().min(8, "Password must be at least 8 characters"), name: z.string().min(1, "Name is required") }).parse(Object.fromEntries(fd));
    const user = await registerUser({ email, password, name });
    await setSessionCookie(user.id);
    redirect("/onboarding");
  } catch (e) { return fail(e); }
}

export async function magicLinkAction(_: State, fd: FormData): Promise<State> {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(Object.fromEntries(fd));
    await requestMagicLink(email, typeof fd.get("next") === "string" ? safeNext(fd.get("next")) : undefined);
    return { info: "If that address is valid, a sign-in link is on its way." };
  } catch (e) { return fail(e); }
}

export async function forgotAction(_: State, fd: FormData): Promise<State> {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(Object.fromEntries(fd));
    await requestPasswordReset(email);
    return { info: "If that address has an account, a reset link is on its way." };
  } catch (e) { return fail(e); }
}

export async function resetAction(_: State, fd: FormData): Promise<State> {
  try {
    const { token, password } = z.object({ token: z.string().min(1), password: z.string().min(8) }).parse(Object.fromEntries(fd));
    const user = await resetPassword(token, password);
    await setSessionCookie(user.id);
    redirect("/app");
  } catch (e) { return fail(e); }
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}

export async function createOrgAction(_: State, fd: FormData): Promise<State> {
  try {
    const { user, session } = await requireUser();
    const { name } = z.object({ name: z.string().trim().min(2, "Organisation name is required").max(80) }).parse(Object.fromEntries(fd));
    const org = await createOrganization(user.id, name);
    await prisma.session.update({ where: { id: session.id }, data: { activeOrgId: org.id } });
    redirect("/app");
  } catch (e) { return fail(e); }
}

export async function switchOrgAction(fd: FormData) {
  const { user, session, orgs } = await requireOrg();
  const orgId = String(fd.get("orgId"));
  if (orgs.some((o) => o.org.id === orgId)) await prisma.session.update({ where: { id: session.id }, data: { activeOrgId: orgId } });
  void user;
  redirect("/app");
}

// ---- 2FA
export async function verifyTotpAction(_: State, fd: FormData): Promise<State> {
  const session = await currentSession();
  if (!session) redirect("/login");
  const code = String(fd.get("code") ?? "");
  const ok = session.user.totpEnabledAt ? verifyTotp(session.user, code) : await confirmTotpSetup(session.user.id, code);
  if (!ok) return { error: "Invalid code" };
  await prisma.session.update({ where: { id: session.id }, data: { mfaVerified: true } });
  redirect("/app");
}

export async function startTotpSetup() {
  const session = await currentSession();
  if (!session) redirect("/login");
  return beginTotpSetup(session.user);
}
