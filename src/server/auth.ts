import type { AuthTokenType, User } from "@prisma/client";
import { authenticator } from "otplib";
import { decrypt, encrypt, hashPassword, hashToken, newToken, verifyPassword } from "./crypto";
import { prisma } from "./db";
import { env } from "./env";
import { sendEmail } from "./email";
import { ActionEmail } from "./email/templates";
import * as React from "react";

const SESSION_DAYS = 30;
const TOKEN_TTL_MIN: Record<AuthTokenType, number> = { VERIFY_EMAIL: 60 * 24, MAGIC_LINK: 15, PASSWORD_RESET: 60 };

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

// ---------------------------------------------------------------- users

export async function registerUser(input: { email: string; password: string; name?: string }): Promise<User> {
  const email = normalizeEmail(input.email);
  if (input.password.length < 8) throw new AuthError("WEAK_PASSWORD", "Password must be at least 8 characters");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.passwordHash) throw new AuthError("EMAIL_TAKEN", "An account with this email already exists");
  const passwordHash = await hashPassword(input.password);
  // A magic-link-only account may already exist; attach the password to it.
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, name: input.name ?? existing.name } })
    : await prisma.user.create({ data: { email, passwordHash, name: input.name } });
  if (!user.emailVerifiedAt) await sendAuthLink("VERIFY_EMAIL", user);
  return user;
}

export async function loginWithPassword(emailRaw: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(emailRaw) } });
  // Same error for unknown user / wrong password to avoid account enumeration.
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password");
  if (user.disabledAt) throw new AuthError("DISABLED", "This account is disabled");
  return user;
}

// ---------------------------------------------------------------- email links

const LINK_COPY: Record<AuthTokenType, { path: string; subject: string; heading: string; body: string; action: string }> = {
  VERIFY_EMAIL: { path: "/auth/verify", subject: "Verify your email", heading: "Verify your email", body: "Confirm your email address to finish setting up your KudoBird account.", action: "Verify email" },
  MAGIC_LINK: { path: "/auth/magic", subject: "Your sign-in link", heading: "Sign in to KudoBird", body: "Use this one-time link to sign in. It expires in 15 minutes.", action: "Sign in" },
  PASSWORD_RESET: { path: "/auth/reset", subject: "Reset your password", heading: "Reset your password", body: "Use this link to choose a new password. It expires in 1 hour.", action: "Reset password" },
};

export async function sendAuthLink(type: AuthTokenType, user: Pick<User, "id" | "email">, next?: string): Promise<void> {
  const { token, hash } = newToken();
  await prisma.authToken.create({
    data: { userId: user.id, email: user.email, type, tokenHash: hash, expiresAt: new Date(Date.now() + TOKEN_TTL_MIN[type] * 60_000) },
  });
  const copy = LINK_COPY[type];
  const url = new URL(copy.path, env().APP_URL);
  url.searchParams.set("token", token);
  if (next) url.searchParams.set("next", next);
  await sendEmail({
    to: user.email,
    subject: copy.subject,
    react: React.createElement(ActionEmail, { preview: copy.subject, heading: copy.heading, body: copy.body, actionLabel: copy.action, actionUrl: url.toString() }),
  });
}

/** Magic links work for new and existing users; the first successful use verifies the email. */
export async function requestMagicLink(emailRaw: string, next?: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const user = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email } }));
  if (user.disabledAt) return; // silent: do not reveal account state
  await sendAuthLink("MAGIC_LINK", user, next);
}

export async function requestPasswordReset(emailRaw: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(emailRaw) } });
  if (user && !user.disabledAt) await sendAuthLink("PASSWORD_RESET", user);
}

/** Single-use token check. Returns the user or throws. */
export async function consumeAuthToken(token: string, type: AuthTokenType): Promise<User> {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date() || !row.user) {
    throw new AuthError("INVALID_TOKEN", "This link is invalid or has expired");
  }
  // Mark used atomically; if a concurrent request won the race, count is 0.
  const claimed = await prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new AuthError("INVALID_TOKEN", "This link is invalid or has expired");
  if (row.user.disabledAt) throw new AuthError("DISABLED", "This account is disabled");
  if (!row.user.emailVerifiedAt && (type === "VERIFY_EMAIL" || type === "MAGIC_LINK")) {
    return prisma.user.update({ where: { id: row.user.id }, data: { emailVerifiedAt: new Date() } });
  }
  return row.user;
}

export async function resetPassword(token: string, newPassword: string): Promise<User> {
  if (newPassword.length < 8) throw new AuthError("WEAK_PASSWORD", "Password must be at least 8 characters");
  const user = await consumeAuthToken(token, "PASSWORD_RESET");
  await prisma.session.deleteMany({ where: { userId: user.id } }); // sign out everywhere
  return prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
}

// ---------------------------------------------------------------- sessions

export async function createSession(
  userId: string,
  opts: { activeOrgId?: string | null; mfaVerified?: boolean; impersonatorId?: string | null; days?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + (opts.days ?? SESSION_DAYS) * 86_400_000);
  await prisma.session.create({
    data: { userId, tokenHash: hash, activeOrgId: opts.activeOrgId ?? null, mfaVerified: opts.mfaVerified ?? false, impersonatorId: opts.impersonatorId ?? null, expiresAt },
  });
  return { token, expiresAt };
}

export async function getSession(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.disabledAt) return null;
  return session;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// ---------------------------------------------------------------- TOTP 2FA

authenticator.options = { window: 1 };

export async function beginTotpSetup(user: User): Promise<{ secret: string; otpauthUrl: string }> {
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encrypt(secret), totpEnabledAt: null } });
  return { secret, otpauthUrl: authenticator.keyuri(user.email, "KudoBird", secret) };
}

export async function confirmTotpSetup(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.totpSecret || !authenticator.check(code.trim(), decrypt(user.totpSecret))) return false;
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } });
  return true;
}

export function verifyTotp(user: Pick<User, "totpSecret" | "totpEnabledAt">, code: string): boolean {
  if (!user.totpSecret || !user.totpEnabledAt) return false;
  return authenticator.check(code.trim(), decrypt(user.totpSecret));
}

export async function disableTotp(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null } });
}

// ---------------------------------------------------------------- Google (optional)

export const googleEnabled = () => !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);

export function googleAuthUrl(state: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env().GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", new URL("/auth/google/callback", env().APP_URL).toString());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  return u.toString();
}

export async function loginWithGoogleCode(code: string): Promise<User> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID!,
      client_secret: env().GOOGLE_CLIENT_SECRET!,
      redirect_uri: new URL("/auth/google/callback", env().APP_URL).toString(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new AuthError("GOOGLE_FAILED", "Google sign-in failed");
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${access_token}` } });
  if (!infoRes.ok) throw new AuthError("GOOGLE_FAILED", "Google sign-in failed");
  const info = (await infoRes.json()) as { sub: string; email: string; email_verified?: boolean; name?: string };
  if (!info.email_verified) throw new AuthError("GOOGLE_UNVERIFIED", "Google account email is not verified");
  const email = normalizeEmail(info.email);
  const existing = (await prisma.user.findUnique({ where: { googleId: info.sub } })) ?? (await prisma.user.findUnique({ where: { email } }));
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { googleId: info.sub, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } })
    : await prisma.user.create({ data: { email, name: info.name, googleId: info.sub, emailVerifiedAt: new Date() } });
  if (user.disabledAt) throw new AuthError("DISABLED", "This account is disabled");
  return user;
}
