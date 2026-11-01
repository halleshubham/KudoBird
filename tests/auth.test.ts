import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { consoleOutbox } from "@/server/email";
import { prisma } from "@/server/db";
import {
  AuthError, beginTotpSetup, confirmTotpSetup, consumeAuthToken, createSession, getSession, loginWithPassword,
  registerUser, requestMagicLink, resetPassword, requestPasswordReset, verifyTotp,
} from "@/server/auth";
import { decrypt, encrypt, hashPassword, verifyPassword } from "@/server/crypto";
import { acceptInvite, inviteMember } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

const created: string[] = [];
const email = () => `auth-${randomUUID()}@test.local`;
const tokenFrom = (to: string) => {
  const mail = [...consoleOutbox()].reverse().find((m) => m.to === to)!;
  return new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
};

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("passwords & crypto", () => {
  it("hashes and verifies; wrong password fails", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("AES-GCM round-trips and is non-deterministic", () => {
    const a = encrypt("+919876543210");
    expect(a).not.toBe(encrypt("+919876543210"));
    expect(decrypt(a)).toBe("+919876543210");
  });
});

describe("registration, login, verification", () => {
  it("registers, emails a verification link, verifies once", async () => {
    const e = email();
    const u = await registerUser({ email: e, password: "password123", name: "A" });
    created.push(u.id);
    expect(u.emailVerifiedAt).toBeNull();
    const t = tokenFrom(e);
    expect((await consumeAuthToken(t, "VERIFY_EMAIL")).emailVerifiedAt).not.toBeNull();
    await expect(consumeAuthToken(t, "VERIFY_EMAIL")).rejects.toBeInstanceOf(AuthError); // single use
  });
  it("rejects duplicate emails, weak passwords, bad credentials without enumeration", async () => {
    const e = email();
    const first = await registerUser({ email: e, password: "password123" });
    created.push(first.id);
    await consumeAuthToken(tokenFrom(e), "VERIFY_EMAIL");
    await expect(registerUser({ email: e.toUpperCase(), password: "password123" })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(registerUser({ email: email(), password: "short" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(loginWithPassword(e, "nope")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(loginWithPassword("ghost@test.local", "nope")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(loginWithPassword(e, "password123")).resolves.toBeTruthy();
  });
  it("an unverified address cannot sign in until the emailed link is used; the link is resent at most once a minute", async () => {
    const e = email();
    const u = await registerUser({ email: e, password: "password123", name: "New" });
    created.push(u.id);
    const sentAtSignup = consoleOutbox().length;
    await expect(loginWithPassword(e, "password123")).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(consoleOutbox().length).toBe(sentAtSignup); // cooldown: the signup email is still fresh, no second one
    await prisma.authToken.updateMany({ where: { userId: u.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await expect(loginWithPassword(e, "password123")).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(consoleOutbox().length).toBe(sentAtSignup + 1); // a fresh link went out after the cooldown
    await expect(loginWithPassword(e, "wrong-password")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" }); // no hint without the password
    await consumeAuthToken(tokenFrom(e), "VERIFY_EMAIL");
    await expect(loginWithPassword(e, "password123")).resolves.toMatchObject({ id: u.id });
  });
  it("registering again before verifying replaces the password, so only the inbox owner ends up in control", async () => {
    const e = email();
    const first = await registerUser({ email: e, password: "attacker-password" });
    created.push(first.id);
    await prisma.authToken.updateMany({ where: { userId: first.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const second = await registerUser({ email: e, password: "owner-password-1" });
    expect(second.id).toBe(first.id);
    await consumeAuthToken(tokenFrom(e), "VERIFY_EMAIL");
    await expect(loginWithPassword(e, "attacker-password")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(loginWithPassword(e, "owner-password-1")).resolves.toBeTruthy();
  });
  it("disabled accounts cannot log in or hold sessions", async () => {
    const e = email();
    const u = await registerUser({ email: e, password: "password123" });
    created.push(u.id);
    const { token } = await createSession(u.id);
    expect(await getSession(token)).not.toBeNull();
    await prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    await expect(loginWithPassword(e, "password123")).rejects.toMatchObject({ code: "DISABLED" });
    expect(await getSession(token)).toBeNull();
  });
});

describe("magic link & password reset", () => {
  it("magic link creates and verifies a user; token types are not interchangeable", async () => {
    const e = email();
    await requestMagicLink(e);
    const t = tokenFrom(e);
    await expect(consumeAuthToken(t, "PASSWORD_RESET")).rejects.toBeInstanceOf(AuthError);
    const u = await consumeAuthToken(t, "MAGIC_LINK");
    created.push(u.id);
    expect(u.emailVerifiedAt).not.toBeNull();
  });
  it("password reset changes the password and signs out all sessions", async () => {
    const e = email();
    const u = await registerUser({ email: e, password: "password123" });
    created.push(u.id);
    const { token: sess } = await createSession(u.id);
    await requestPasswordReset(e);
    await resetPassword(tokenFrom(e), "newpassword456");
    expect(await getSession(sess)).toBeNull();
    await expect(loginWithPassword(e, "password123")).rejects.toBeInstanceOf(AuthError);
    await expect(loginWithPassword(e, "newpassword456")).resolves.toBeTruthy();
  });
  it("expired tokens are refused", async () => {
    const e = email();
    await requestMagicLink(e);
    const t = tokenFrom(e);
    await prisma.authToken.updateMany({ where: { email: e }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(consumeAuthToken(t, "MAGIC_LINK")).rejects.toBeInstanceOf(AuthError);
    created.push((await prisma.user.findUniqueOrThrow({ where: { email: e } })).id);
  });
});

describe("TOTP 2FA", () => {
  it("enrols, verifies, and rejects wrong codes", async () => {
    const u = await registerUser({ email: email(), password: "password123" });
    created.push(u.id);
    const { secret } = await beginTotpSetup(u);
    expect(await confirmTotpSetup(u.id, "000000")).toBe(false);
    expect(await confirmTotpSetup(u.id, authenticator.generate(secret))).toBe(true);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(fresh.totpSecret).not.toContain(secret); // stored encrypted
    expect(verifyTotp(fresh, authenticator.generate(secret))).toBe(true);
    expect(verifyTotp(fresh, "123456")).toBe(false);
  });
});

describe("invites", () => {
  it("accepting requires the invited, verified email; token is single use", async () => {
    const T = await makeOrg();
    const invitee = email();
    const { token } = await inviteMember({ ...T.ctx("OWNER"), role: "OWNER" }, invitee, "EDITOR");
    const stranger = await prisma.user.create({ data: { email: email(), emailVerifiedAt: new Date() } });
    created.push(stranger.id);
    await expect(acceptInvite(token, stranger)).rejects.toMatchObject({ code: "EMAIL_MISMATCH" });
    const unverified = await prisma.user.create({ data: { email: invitee } });
    created.push(unverified.id);
    await expect(acceptInvite(token, unverified)).rejects.toMatchObject({ code: "EMAIL_MISMATCH" });
    const verified = await prisma.user.update({ where: { id: unverified.id }, data: { emailVerifiedAt: new Date() } });
    await expect(acceptInvite(token, verified)).resolves.toEqual({ orgId: T.org.id });
    await expect(acceptInvite(token, verified)).rejects.toMatchObject({ code: "INVALID_INVITE" });
    await cleanup([T.org.id], T.members.map((m) => m.userId));
  });
});
