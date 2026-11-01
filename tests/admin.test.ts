import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma, withPlatform, withTenant } from "@/server/db";
import { AdminError, assertSuperAdmin } from "@/server/admin/guard";
import * as orgsAdmin from "@/server/admin/orgs";
import * as usersAdmin from "@/server/admin/users";
import * as content from "@/server/admin/content";
import { listSupportAccess, startImpersonation, stopImpersonation, IMPERSONATION_MINUTES } from "@/server/admin/impersonation";
import { getPlatformStats } from "@/server/admin/stats";
import { acceptInvite, createOrganization, listUserOrgs, resolveOrgContext, usableOrgs, inviteMember, type OrgContext } from "@/server/orgs";
import { getSession, loginWithPassword, registerUser, requestMagicLink, AuthError } from "@/server/auth";
import { assertWithinLimit, effectiveEntitlements } from "@/server/entitlements";
import { consoleOutbox, setEmailTransport } from "@/server/email";
import { getPlatformSettings, savePlatformSettings } from "@/server/platform-settings";
import { createCampaign, submitEntry, updateCampaign, cloneTemplate } from "@/server/campaigns/service";
import { getPublicOrg } from "@/server/public-org";
import { setStorage } from "@/server/storage";
import { presetDesign } from "@/server/render/presets";
import { cleanup, makeOrg, makeUser } from "./helpers";

const deleted: string[] = [];
const createdUsers: string[] = [];
const createdPlans: string[] = [];
let originalSettings: Awaited<ReturnType<typeof getPlatformSettings>>;
let originalDefaultKey: string | undefined;
let admin: { id: string; email: string };
let normal: Awaited<ReturnType<typeof makeUser>>;
const orgsToClean: Awaited<ReturnType<typeof makeOrg>>[] = [];

async function makeAdmin(opts: { totp?: boolean; verified?: boolean } = {}) {
  const u = await prisma.user.create({ data: { email: `admin-${randomUUID()}@test.local`, isSuperAdmin: true, emailVerifiedAt: opts.verified === false ? null : new Date(), totpEnabledAt: opts.totp === false ? null : new Date(), totpSecret: "x" } });
  createdUsers.push(u.id);
  return u;
}
async function org(extra: ("ADMIN" | "EDITOR" | "VIEWER")[] = []) { const o = await makeOrg(extra); orgsToClean.push(o); return o; }

beforeAll(async () => {
  setStorage({ put: async () => {}, get: async () => Buffer.from("x"), delete: async (k) => { deleted.push(k); } });
  originalSettings = await getPlatformSettings();
  originalDefaultKey = (await prisma.plan.findFirst({ where: { isDefault: true } }))?.key;
  const a = await makeAdmin();
  admin = { id: a.id, email: a.email };
  normal = await makeUser("normal");
  createdUsers.push(normal.id);
});
afterAll(async () => {
  await savePlatformSettings(originalSettings);
  // organisations first: they reference the test plans
  await cleanup(orgsToClean.map((o) => o.org.id), orgsToClean.flatMap((o) => o.members.map((m) => m.userId)));
  if (originalDefaultKey) { await prisma.plan.updateMany({ data: { isDefault: false } }); await prisma.plan.update({ where: { key: originalDefaultKey }, data: { isDefault: true, active: true } }); }
  await prisma.plan.deleteMany({ where: { key: { in: createdPlans } } });
  await prisma.platformAudit.deleteMany({ where: { actorId: { in: createdUsers } } });
  await withPlatform((tx) => tx.template.deleteMany({ where: { orgId: null, name: { startsWith: "ZZ test" } } }));
  await prisma.font.deleteMany({ where: { family: { startsWith: "ZZ Test" } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  setStorage(undefined);
  await prisma.$disconnect();
});

describe("platform admin access", () => {
  it("requires super admin + enabled + 2FA enrolled, checked against the database", async () => {
    await expect(assertSuperAdmin(normal.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertSuperAdmin(randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const noMfa = await makeAdmin({ totp: false });
    await expect(assertSuperAdmin(noMfa.id)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const off = await makeAdmin();
    await prisma.user.update({ where: { id: off.id }, data: { disabledAt: new Date() } });
    await expect(assertSuperAdmin(off.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertSuperAdmin(admin.id)).resolves.toMatchObject({ id: admin.id });
  });

  it("EVERY admin function refuses an ordinary user, and changes nothing", async () => {
    const o = await org();
    const id = normal.id, oid = o.org.id, uid = o.owner.id;
    const calls: [string, () => Promise<unknown>][] = [
      ["listOrgs", () => orgsAdmin.listOrgs(id)], ["getOrgDetail", () => orgsAdmin.getOrgDetail(id, oid)],
      ["createOrgForOwner", () => orgsAdmin.createOrgForOwner(id, { name: "Evil Org", ownerEmail: "e@e.com" })],
      ["setOrgPlan", () => orgsAdmin.setOrgPlan(id, oid, "free")], ["setOrgOverrides", () => orgsAdmin.setOrgOverrides(id, oid, { limits: { members: 9999 } })],
      ["setOrgStatus", () => orgsAdmin.setOrgStatus(id, oid, "SUSPENDED")], ["softDeleteOrg", () => orgsAdmin.softDeleteOrg(id, oid)],
      ["restoreOrg", () => orgsAdmin.restoreOrg(id, oid)], ["purgeOrg", () => orgsAdmin.purgeOrg(id, oid, o.org.slug)],
      ["listUsers", () => usersAdmin.listUsers(id)], ["setUserDisabled", () => usersAdmin.setUserDisabled(id, uid, true)],
      ["setSuperAdmin", () => usersAdmin.setSuperAdmin(id, uid, true)], ["resetUserTotp", () => usersAdmin.resetUserTotp(id, uid)], ["sendUserPasswordReset", () => usersAdmin.sendUserPasswordReset(id, uid)],
      ["startImpersonation", () => startImpersonation(id, { orgId: oid, userId: uid, reason: "pretending to be support" })],
      ["getPlatformStats", () => getPlatformStats(id)], ["getSettings", () => content.getSettings(id)], ["updateSettings", () => content.updateSettings(id, { signupsOpen: false, defaultPlanKey: "free", announcement: "" })],
      ["listPlans", () => content.listPlans(id)], ["upsertPlan", () => content.upsertPlan(id, { key: "evil", name: "Evil", limits: {}, features: {} })],
      ["listGlobalTemplates", () => content.listGlobalTemplates(id)], ["createGlobalTemplate", () => content.createGlobalTemplate(id, { name: "Evil", preset: "classic" })],
      ["saveGlobalTemplateDesign", () => content.saveGlobalTemplateDesign(id, randomUUID(), presetDesign("classic"))], ["renameGlobalTemplate", () => content.renameGlobalTemplate(id, randomUUID(), "x")], ["deleteGlobalTemplate", () => content.deleteGlobalTemplate(id, randomUUID())],
      ["listFontsAdmin", () => content.listFontsAdmin(id)], ["setFontCurated", () => content.setFontCurated(id, "Mukta", true)], ["syncFonts", () => content.syncFonts(id)], ["precacheFont", () => content.precacheFont(id, "Mukta")],
      ["listPlatformAudit", () => content.listPlatformAudit(id)], ["listAllOrgAudit", () => content.listAllOrgAudit(id)],
    ];
    for (const [name, fn] of calls) await expect(fn(), name).rejects.toMatchObject({ code: "FORBIDDEN" });
    const fresh = await withPlatform((tx) => tx.organization.findUniqueOrThrow({ where: { id: oid } }));
    expect(fresh).toMatchObject({ status: "ACTIVE", deletedAt: null, limitOverrides: {} });
    expect(await prisma.platformAudit.count({ where: { actorId: id } })).toBe(0);
    expect((await getPlatformSettings()).signupsOpen).toBe(originalSettings.signupsOpen);
  });
});

describe("organisation management", () => {
  it("lists with counts and filters; shows details", async () => {
    const o = await org(["EDITOR"]);
    const r = await orgsAdmin.listOrgs(admin.id, { q: o.org.slug });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: o.org.id, members: 2, campaigns: 0, certificates: 0, plan: { key: expect.any(String) } });
    expect((await orgsAdmin.listOrgs(admin.id, { q: o.org.slug, status: "SUSPENDED" })).rows).toHaveLength(0);
    const d = await orgsAdmin.getOrgDetail(admin.id, o.org.id);
    expect(d.members).toHaveLength(2);
    await expect(orgsAdmin.getOrgDetail(admin.id, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates an org for an existing user (owner at once) or invites a new owner by email", async () => {
    const existing = await makeUser("existing"); createdUsers.push(existing.id);
    const a = await orgsAdmin.createOrgForOwner(admin.id, { name: `Existing Owner Org ${randomUUID().slice(0, 4)}`, ownerEmail: existing.email.toUpperCase() });
    orgsToClean.push({ org: a.org, owner: existing, members: [], ctx: () => ({}) as never } as never);
    expect(a.invited).toBe(false);
    expect(await resolveOrgContext(existing.id, a.org.id)).toMatchObject({ role: "OWNER" });

    const email = `newowner-${randomUUID()}@test.local`;
    const b = await orgsAdmin.createOrgForOwner(admin.id, { name: `Invited Owner Org ${randomUUID().slice(0, 4)}`, ownerEmail: email });
    orgsToClean.push({ org: b.org, owner: existing, members: [], ctx: () => ({}) as never } as never);
    expect(b.invited).toBe(true);
    const mail = [...consoleOutbox()].reverse().find((m) => m.to === email)!;
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    const u = await registerUser({ email, password: "password123" });
    createdUsers.push(u.id);
    const verified = await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
    expect(await acceptInvite(token, verified)).toEqual({ orgId: b.org.id });
    expect(await resolveOrgContext(u.id, b.org.id)).toMatchObject({ role: "OWNER" });
    await expect(orgsAdmin.createOrgForOwner(admin.id, { name: "x", ownerEmail: "bad" })).rejects.toMatchObject({ code: "INVALID" });
    expect((await prisma.platformAudit.findMany({ where: { actorId: admin.id, action: "org.created" } })).length).toBeGreaterThanOrEqual(2);
  });

  it("changing the plan and per-org overrides changes what the entitlement service allows", async () => {
    const plan = await content.upsertPlan(admin.id, { key: `zz-test-${randomUUID().slice(0, 6)}`, name: "ZZ Tiny", limits: { members: 1, campaigns: 1 }, features: { bulkIssue: false }, active: true });
    createdPlans.push(plan.key);
    const o = await org();
    await orgsAdmin.setOrgPlan(admin.id, o.org.id, plan.key);
    const ctx = o.ctx("OWNER") as OrgContext;
    await expect(withTenant(ctx, (tx) => assertWithinLimit(tx, o.org.id, "members"))).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    await orgsAdmin.setOrgOverrides(admin.id, o.org.id, { limits: { members: 10, campaigns: null }, features: { customDomain: true } });
    await expect(withTenant(ctx, (tx) => assertWithinLimit(tx, o.org.id, "members"))).resolves.toBeUndefined();
    const row = await withPlatform((tx) => tx.organization.findUniqueOrThrow({ where: { id: o.org.id }, include: { plan: true } }));
    expect(effectiveEntitlements(row.plan, row.limitOverrides)).toMatchObject({ limits: { members: 10, campaigns: 1 }, features: { customDomain: true } });
    const subs = await withPlatform((tx) => tx.subscription.findMany({ where: { orgId: o.org.id }, orderBy: { createdAt: "asc" } }));
    expect(subs.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
    expect(subs.at(-1)?.planId).toBe(plan.id);
    await expect(orgsAdmin.setOrgPlan(admin.id, o.org.id, "no-such-plan")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(orgsAdmin.setOrgOverrides(admin.id, o.org.id, { limits: { bogus: 1 } })).rejects.toMatchObject({ code: "INVALID" });
    await expect(orgsAdmin.setOrgOverrides(admin.id, o.org.id, { limits: { members: -5 } })).rejects.toMatchObject({ code: "INVALID" });
    await expect(orgsAdmin.setOrgOverrides(admin.id, o.org.id, { features: { teleport: true } })).rejects.toMatchObject({ code: "INVALID" });
    const log = await withTenant(ctx, (tx) => tx.auditLog.findMany({ where: { action: { in: ["plan.changed", "limits.changed"] } } }));
    expect(log.map((l) => l.action).sort()).toEqual(["limits.changed", "plan.changed"]); // the org can see what was changed
  });

  it("suspending locks members out and stops public intake; reactivating restores both; issued certificates stay", async () => {
    const o = await org(["EDITOR"]);
    const ctx = o.ctx("OWNER") as OrgContext;
    const camp = await createCampaign(ctx, { name: "Suspend Test", locale: "en", preset: "classic" });
    await updateCampaign(ctx, camp.id, { status: "ACTIVE", settings: { captcha: false } });
    const raw = (m: string) => ({ name: "Some Person", mobile: m, consent: "on" });
    vi.resetModules();
    expect(await submitEntry({ orgSlug: o.org.slug, campaignSlug: camp.slug, raw: raw("9700000001"), locale: "en", ip: "10.20.0.1" })).toMatchObject({ ok: true });
    await orgsAdmin.setOrgStatus(admin.id, o.org.id, "SUSPENDED", "abuse report #12");
    expect(await resolveOrgContext(o.owner.id, o.org.id)).toBeNull();
    expect((await listUserOrgs(o.owner.id))[0].org.status).toBe("SUSPENDED");
    expect(usableOrgs(await listUserOrgs(o.owner.id), { activeOrgId: o.org.id, impersonatorId: null })).toHaveLength(0);
    expect(await submitEntry({ orgSlug: o.org.slug, campaignSlug: camp.slug, raw: raw("9700000002"), locale: "en", ip: "10.20.0.2" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await getPublicOrg(o.org.slug)).toBeNull();
    await expect(startImpersonation(admin.id, { orgId: o.org.id, userId: o.owner.id, reason: "should not be allowed" })).rejects.toMatchObject({ code: "ORG_INACTIVE" });
    await orgsAdmin.setOrgStatus(admin.id, o.org.id, "ACTIVE");
    expect(await resolveOrgContext(o.owner.id, o.org.id)).toMatchObject({ role: "OWNER" });
    expect(await submitEntry({ orgSlug: o.org.slug, campaignSlug: camp.slug, raw: raw("9700000003"), locale: "en", ip: "10.20.0.3" })).toMatchObject({ ok: true });
    const log = await withTenant(ctx, (tx) => tx.auditLog.findMany({ where: { action: { startsWith: "org.suspended" } } }));
    expect(log[0].meta).toMatchObject({ reason: "abuse report #12" });
  });

  it("delete is recoverable; purge needs deletion first and the exact slug, then removes data and files", async () => {
    const o = await org();
    const ctx = o.ctx("OWNER") as OrgContext;
    const camp = await createCampaign(ctx, { name: "Purge Test", locale: "en", preset: "classic" });
    await updateCampaign(ctx, camp.id, { status: "ACTIVE", settings: { captcha: false } });
    const r = await submitEntry({ orgSlug: o.org.slug, campaignSlug: camp.slug, raw: { name: "Gone Person", mobile: "9700000010", consent: "on" }, locale: "en", ip: "10.21.0.1" });
    const cert = await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
    await withPlatform(async (tx) => {
      await tx.certificate.update({ where: { id: cert.id }, data: { outputs: { square: { key: `purge-out-${cert.id}`, hash: "h", mime: "image/png" } } } });
      await tx.asset.create({ data: { orgId: o.org.id, kind: "LOGO", storageKey: `purge-asset-${o.org.id}`, mime: "image/png", bytes: 1, filename: "l.png" } });
    });
    await expect(orgsAdmin.purgeOrg(admin.id, o.org.id, o.org.slug)).rejects.toMatchObject({ code: "NOT_DELETED" });
    await orgsAdmin.softDeleteOrg(admin.id, o.org.id);
    expect(await listUserOrgs(o.owner.id)).toHaveLength(0);
    expect(await resolveOrgContext(o.owner.id, o.org.id)).toBeNull();
    expect((await orgsAdmin.listOrgs(admin.id, { q: o.org.slug })).rows).toHaveLength(0);
    expect((await orgsAdmin.listOrgs(admin.id, { q: o.org.slug, status: "DELETED" })).rows).toHaveLength(1);
    await orgsAdmin.restoreOrg(admin.id, o.org.id);
    expect(await resolveOrgContext(o.owner.id, o.org.id)).toMatchObject({ role: "OWNER" });
    await orgsAdmin.softDeleteOrg(admin.id, o.org.id);
    await expect(orgsAdmin.purgeOrg(admin.id, o.org.id, "wrong-slug")).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(await withPlatform((tx) => tx.organization.count({ where: { id: o.org.id } }))).toBe(1);
    const res = await orgsAdmin.purgeOrg(admin.id, o.org.id, o.org.slug);
    expect(res.purgedFiles).toBe(2);
    expect(deleted).toEqual(expect.arrayContaining([`purge-out-${cert.id}`, `purge-asset-${o.org.id}`]));
    const left = await withPlatform(async (tx) => [await tx.organization.count({ where: { id: o.org.id } }), await tx.campaign.count({ where: { orgId: o.org.id } }), await tx.entry.count({ where: { orgId: o.org.id } }), await tx.certificate.count({ where: { orgId: o.org.id } }), await tx.membership.count({ where: { orgId: o.org.id } }), await tx.auditLog.count({ where: { orgId: o.org.id } })]);
    expect(left).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await prisma.user.count({ where: { id: o.owner.id } })).toBe(1); // users outlive an org
    expect(await prisma.platformAudit.findFirst({ where: { action: "org.purged", entityId: o.org.id } })).toMatchObject({ meta: { slug: o.org.slug, files: 2 } });
  });
});

describe("user management", () => {
  it("disabling signs the user out everywhere and blocks login; enabling restores; cannot disable yourself", async () => {
    const e = `dis-${randomUUID()}@test.local`;
    const u = await registerUser({ email: e, password: "password123" });
    createdUsers.push(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } }); // password sign-in needs a verified address
    const { createSession } = await import("@/server/auth");
    const { token } = await createSession(u.id);
    await usersAdmin.setUserDisabled(admin.id, u.id, true);
    expect(await getSession(token)).toBeNull();
    await expect(loginWithPassword(e, "password123")).rejects.toMatchObject({ code: "DISABLED" });
    await usersAdmin.setUserDisabled(admin.id, u.id, false);
    await expect(loginWithPassword(e, "password123")).resolves.toBeTruthy();
    await expect(usersAdmin.setUserDisabled(admin.id, admin.id, true)).rejects.toMatchObject({ code: "INVALID" });
  });
  it("promote/demote guards: not yourself, only verified enabled accounts", async () => {
    const target = await makeUser("promo"); createdUsers.push(target.id);
    await usersAdmin.setSuperAdmin(admin.id, target.id, true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isSuperAdmin).toBe(true);
    await expect(assertSuperAdmin(target.id)).rejects.toMatchObject({ code: "MFA_REQUIRED" }); // promoted but not yet useful without 2FA
    await usersAdmin.setSuperAdmin(admin.id, target.id, false);
    await expect(usersAdmin.setSuperAdmin(admin.id, admin.id, false)).rejects.toMatchObject({ code: "INVALID" });
    const unverified = await prisma.user.create({ data: { email: `unv-${randomUUID()}@test.local` } }); createdUsers.push(unverified.id);
    await expect(usersAdmin.setSuperAdmin(admin.id, unverified.id, true)).rejects.toMatchObject({ code: "INVALID" });
  });
  it("2FA reset clears the secret and signs the user out; password reset email is sent", async () => {
    const t = await prisma.user.create({ data: { email: `tot-${randomUUID()}@test.local`, emailVerifiedAt: new Date(), totpEnabledAt: new Date(), totpSecret: "s" } }); createdUsers.push(t.id);
    await usersAdmin.resetUserTotp(admin.id, t.id);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ totpSecret: null, totpEnabledAt: null });
    await expect(usersAdmin.resetUserTotp(admin.id, admin.id)).rejects.toMatchObject({ code: "INVALID" });
    await usersAdmin.sendUserPasswordReset(admin.id, t.id);
    expect([...consoleOutbox()].some((m) => m.to === t.email && /reset/i.test(m.subject))).toBe(true);
  });
  it("search finds users and shows their organisations", async () => {
    const o = await org();
    const r = await usersAdmin.listUsers(admin.id, { q: o.owner.email });
    expect(r.rows[0]).toMatchObject({ email: o.owner.email, orgs: [{ id: o.org.id, role: "OWNER" }] });
  });
});

describe("support access (impersonation)", () => {
  it("needs a real reason, a member, a non-admin, an enabled user", async () => {
    const o = await org(["VIEWER"]);
    const viewer = o.members.find((m) => m.role === "VIEWER")!;
    await expect(startImpersonation(admin.id, { orgId: o.org.id, userId: viewer.userId, reason: "too short" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(startImpersonation(admin.id, { orgId: o.org.id, userId: normal.id, reason: "ticket #123 investigation" })).rejects.toMatchObject({ code: "NOT_MEMBER" });
    const otherAdmin = await makeAdmin();
    await withPlatform((tx) => tx.membership.create({ data: { orgId: o.org.id, userId: otherAdmin.id, role: "ADMIN" } }));
    await expect(startImpersonation(admin.id, { orgId: o.org.id, userId: otherAdmin.id, reason: "ticket #123 investigation" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.user.update({ where: { id: viewer.userId }, data: { disabledAt: new Date() } });
    await expect(startImpersonation(admin.id, { orgId: o.org.id, userId: viewer.userId, reason: "ticket #123 investigation" })).rejects.toMatchObject({ code: "DISABLED" });
    expect(await prisma.session.count({ where: { impersonatorId: admin.id, activeOrgId: o.org.id } })).toBe(0);
    expect(await withPlatform((tx) => tx.impersonationLog.count({ where: { orgId: o.org.id } }))).toBe(0);
  });

  it("opens a short, org-pinned session that is logged, audited, visible to the org and emailed to owners", async () => {
    const o = await org(["ADMIN", "VIEWER"]);
    const target = o.members.find((m) => m.role === "ADMIN")!;
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    const ownerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: o.owner.id } })).email;
    const s = await startImpersonation(admin.id, { orgId: o.org.id, userId: target.userId, reason: "Ticket #4821: cannot upload logo" });
    const session = (await getSession(s.token))!;
    expect(session).toMatchObject({ userId: target.userId, impersonatorId: admin.id, activeOrgId: o.org.id, mfaVerified: true });
    expect(session.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(IMPERSONATION_MINUTES * 60_000 + 5_000);
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(50 * 60_000);

    const ownerCtx = o.ctx("OWNER") as OrgContext;
    const support = await listSupportAccess(ownerCtx);
    expect(support[0]).toMatchObject({ adminEmail: admin.email, targetEmail: targetUser.email, reason: "Ticket #4821: cannot upload logo", state: "active" });
    const audit = await withTenant(ownerCtx, (tx) => tx.auditLog.findMany({ where: { action: "support.access_started" } }));
    expect(audit[0]).toMatchObject({ actorId: admin.id });
    const mail = [...consoleOutbox()].reverse().find((m) => m.to === ownerEmail && /support accessed/i.test(m.subject));
    expect(mail?.text).toContain(admin.email);
    expect(mail?.text).toContain("Ticket #4821");
    // the org's other roles: viewers cannot read it, other orgs see nothing
    await expect(listSupportAccess(o.ctx("VIEWER") as OrgContext)).rejects.toThrow(/Forbidden/);
    const other = await org();
    expect(await listSupportAccess(other.ctx("OWNER") as OrgContext)).toHaveLength(0);

    // actions during the session are attributed to the admin
    const ctx = (await resolveOrgContext(target.userId, o.org.id, admin.id))!;
    expect(ctx.impersonatorId).toBe(admin.id);
    await inviteMember(ctx, `invitee-${randomUUID()}@test.local`, "VIEWER");
    const row = await withTenant(ownerCtx, (tx) => tx.auditLog.findFirstOrThrow({ where: { action: "member.invited" } }));
    expect(row).toMatchObject({ actorId: target.userId, impersonatorId: admin.id });

    // stop
    await stopImpersonation(s.token);
    expect(await getSession(s.token)).toBeNull();
    expect((await listSupportAccess(ownerCtx))[0].state).toBe("ended");
    expect((await withTenant(ownerCtx, (tx) => tx.auditLog.findMany({ where: { action: "support.access_ended" } }))).length).toBe(1);
    expect(await stopImpersonation(s.token)).toBeNull(); // idempotent
  });

  it("is pinned to one organisation: the user's other orgs stay out of reach", async () => {
    const a = await org(), b = await org();
    await withPlatform((tx) => tx.membership.create({ data: { orgId: b.org.id, userId: a.owner.id, role: "ADMIN" } }));
    const all = await listUserOrgs(a.owner.id);
    expect(all).toHaveLength(2);
    expect(usableOrgs(all, { activeOrgId: a.org.id, impersonatorId: null })).toHaveLength(2);
    const pinned = usableOrgs(all, { activeOrgId: a.org.id, impersonatorId: admin.id });
    expect(pinned.map((x) => x.org.id)).toEqual([a.org.id]);
  });

  it("an open session older than the window is reported as expired", async () => {
    const o = await org();
    const old = await withPlatform((tx) => tx.impersonationLog.create({ data: { orgId: o.org.id, adminId: admin.id, adminEmail: admin.email, targetUserId: o.owner.id, targetEmail: "x@y.z", reason: "old session never closed", startedAt: new Date(Date.now() - 3 * 3600_000) } }));
    expect((await listSupportAccess(o.ctx("OWNER") as OrgContext)).find((x) => x.id === old.id)?.state).toBe("expired");
  });
});

describe("global settings", () => {
  it("closing sign-ups blocks NEW accounts only (password, magic link) and leaves existing users and orgs alone", async () => {
    const existing = await makeUser("exists"); createdUsers.push(existing.id);
    await content.updateSettings(admin.id, { signupsOpen: false, defaultPlanKey: originalSettings.defaultPlanKey, announcement: "Maintenance tonight" });
    await expect(registerUser({ email: `new-${randomUUID()}@test.local`, password: "password123" })).rejects.toMatchObject({ code: "SIGNUPS_CLOSED" });
    const email = `magic-${randomUUID()}@test.local`;
    await expect(requestMagicLink(email)).rejects.toBeInstanceOf(AuthError);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    await expect(requestMagicLink(existing.email)).resolves.toBeUndefined();
    expect((await getPlatformSettings()).announcement).toBe("Maintenance tonight");
    await content.updateSettings(admin.id, { signupsOpen: true, defaultPlanKey: originalSettings.defaultPlanKey, announcement: "" });
    const r = await registerUser({ email, password: "password123" }); createdUsers.push(r.id);
    expect(r.email).toBe(email);
  });
  it("the default plan setting decides the plan of newly created organisations; unknown plans are rejected", async () => {
    const plan = await content.upsertPlan(admin.id, { key: `zz-test-${randomUUID().slice(0, 6)}`, name: "ZZ Default", limits: { members: 3 }, features: {}, active: true }); createdPlans.push(plan.key);
    await expect(content.updateSettings(admin.id, { signupsOpen: true, defaultPlanKey: "does-not-exist", announcement: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await content.updateSettings(admin.id, { signupsOpen: true, defaultPlanKey: plan.key, announcement: "" });
    const u = await makeUser("planuser"); createdUsers.push(u.id);
    const created = await createOrganization(u.id, `Default Plan Org ${randomUUID().slice(0, 4)}`);
    orgsToClean.push({ org: created, owner: u, members: [{ userId: u.id, role: "OWNER" }], ctx: () => ({}) as never } as never);
    expect(created.planId).toBe(plan.id);
    await content.updateSettings(admin.id, { ...originalSettings });
  });
});

describe("plans", () => {
  it("validates keys, limits and features; keeps exactly one default; protects the default from deactivation", async () => {
    await expect(content.upsertPlan(admin.id, { key: "Bad Key", name: "x1", limits: {}, features: {} })).rejects.toThrow();
    await expect(content.upsertPlan(admin.id, { key: "zz-bad-limit", name: "Bad", limits: { bogus: 1 }, features: {} })).rejects.toThrow();
    await expect(content.upsertPlan(admin.id, { key: "zz-bad-feat", name: "Bad", limits: {}, features: { teleport: true } })).rejects.toThrow();
    await expect(content.upsertPlan(admin.id, { key: "zz-neg", name: "Bad", limits: { members: -7 }, features: {} })).rejects.toThrow();
    const a = await content.upsertPlan(admin.id, { key: `zz-test-${randomUUID().slice(0, 6)}`, name: "ZZ A", limits: { members: 5 }, features: { api: true }, isDefault: true, active: true }); createdPlans.push(a.key);
    expect((await prisma.plan.findMany({ where: { isDefault: true } })).map((p) => p.key)).toEqual([a.key]);
    await expect(content.upsertPlan(admin.id, { key: a.key, name: "ZZ A", limits: {}, features: {}, isDefault: true, active: false })).rejects.toMatchObject({ code: "INVALID" });
    const updated = await content.upsertPlan(admin.id, { key: a.key, name: "ZZ A2", limits: { members: 9 }, features: {}, isDefault: true, active: true });
    expect(updated).toMatchObject({ id: a.id, name: "ZZ A2", limits: { members: 9 } });
    const listed = await content.listPlans(admin.id);
    expect(listed.find((p) => p.key === a.key)).toMatchObject({ orgs: 0 });
  });
});

describe("starter templates, fonts, audit, stats", () => {
  it("global templates: create, version, rename, delete; clones owned by orgs are unaffected", async () => {
    const t = await content.createGlobalTemplate(admin.id, { name: "ZZ test gala", preset: "festive", locale: "mr" });
    const o = await org(["EDITOR"]);
    const clone = await cloneTemplate(o.ctx("EDITOR") as OrgContext, t.id);
    const design = presetDesign("modern", "en"); design.blocks.title.text = "Changed globally";
    expect(await content.saveGlobalTemplateDesign(admin.id, t.id, JSON.stringify(design))).toEqual({ version: 2 });
    await expect(content.saveGlobalTemplateDesign(admin.id, t.id, "{ not json")).rejects.toThrow();
    await expect(content.saveGlobalTemplateDesign(admin.id, t.id, { nope: 1 })).rejects.toThrow();
    const cloneV = await withPlatform((tx) => tx.templateVersion.findFirstOrThrow({ where: { templateId: clone.id } }));
    expect(JSON.stringify(cloneV.design)).not.toContain("Changed globally");
    const listed = (await content.listGlobalTemplates(admin.id)).find((x) => x.id === t.id)!;
    expect(listed).toMatchObject({ latestVersion: 2, name: "ZZ test gala" });
    await content.renameGlobalTemplate(admin.id, t.id, "ZZ test gala 2");
    await content.deleteGlobalTemplate(admin.id, t.id);
    expect(await withPlatform((tx) => tx.template.count({ where: { id: clone.id } }))).toBe(1);
    await expect(content.deleteGlobalTemplate(admin.id, clone.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // an org's own template is not a global one
  });

  it("fonts: curation is admin-controlled and survives a catalogue sync; bundled fonts cannot be removed", async () => {
    const fam = `ZZ Test Serif ${randomUUID().slice(0, 4)}`;
    await prisma.font.create({ data: { family: fam, subsets: ["latin"], weights: [400], popularity: 5, curated: false } });
    await content.setFontCurated(admin.id, fam, true);
    await prisma.font.upsert({ where: { family: "Mukta" }, update: {}, create: { family: "Mukta", subsets: ["devanagari", "latin"], weights: [400, 700], popularity: 1, curated: true, bundled: true } });
    await expect(content.setFontCurated(admin.id, "Mukta", false)).rejects.toMatchObject({ code: "INVALID" });
    await expect(content.setFontCurated(admin.id, "ZZ Nonexistent", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const fresh = `ZZ Test Fresh ${randomUUID().slice(0, 4)}`;
    const meta = { familyMetadataList: [{ family: fam, category: "serif", subsets: ["latin", "devanagari"], fonts: { "400": {}, "700": {} }, popularity: 3 }, { family: fresh, category: "sans-serif", subsets: ["latin"], fonts: { "400": {} }, popularity: 9 }] };
    vi.stubGlobal("fetch", async () => new Response(`)]}'\n${JSON.stringify(meta)}`));
    try { expect(await content.syncFonts(admin.id)).toBe(2); } finally { vi.unstubAllGlobals(); }
    expect(await prisma.font.findUniqueOrThrow({ where: { family: fam } })).toMatchObject({ curated: true, weights: [400, 700], subsets: ["latin", "devanagari"], popularity: 3 }); // metadata refreshed, curation kept
    expect(await prisma.font.findUniqueOrThrow({ where: { family: fresh } })).toMatchObject({ curated: false });
    const q = await content.listFontsAdmin(admin.id, { q: "ZZ Test Serif", curatedOnly: true });
    expect(q.rows.map((f) => f.family)).toContain(fam);
    expect(await content.precacheFont(admin.id, "Mukta")).toMatchObject({ slug: "mukta" }); // bundled: no network needed
    await expect(content.precacheFont(admin.id, "ZZ Nonexistent")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("platform actions are audited; all-org audit view shows activity across organisations with filters", async () => {
    const pa = await content.listPlatformAudit(admin.id, { action: "org." });
    expect(pa.rows.length).toBeGreaterThan(3);
    expect(pa.rows.every((r) => r.action.startsWith("org."))).toBe(true);
    expect(pa.rows[0].actorEmail).toBe(admin.email);
    const all = await content.listAllOrgAudit(admin.id, { action: "support." });
    expect(all.rows.length).toBeGreaterThan(0);
    expect(new Set(all.rows.map((r) => r.orgId)).size).toBeGreaterThanOrEqual(1);
    expect(all.rows.every((r) => r.action.startsWith("support."))).toBe(true);
    const one = await content.listAllOrgAudit(admin.id, { orgId: orgsToClean[0].org.id });
    expect(one.rows.every((r) => r.orgId === orgsToClean[0].org.id)).toBe(true);
  });

  it("platform stats count organisations, users, certificates and report queue health", async () => {
    const before = await getPlatformStats(admin.id);
    const o = await org();
    const after = await getPlatformStats(admin.id);
    expect(after.orgs.active).toBe(before.orgs.active + 1);
    expect(after.users.total).toBe(before.users.total + 1);
    expect(after.certificatesPerDay).toHaveLength(30);
    expect(after.signupsPerDay.at(-1)!.count).toBeGreaterThan(0);
    expect(after.queues.ok).toBe(true);
    expect(after.emailHealth).toMatchObject({ total: expect.any(Number), bounced: expect.any(Number) });
    void o;
  });
});
