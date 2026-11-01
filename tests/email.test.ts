import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueRenders: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform, withTenant } from "@/server/db";
import { createCampaign, reviewEntry, submitEntry, updateCampaign } from "@/server/campaigns/service";
import { setEmailTransport, type EmailTransport } from "@/server/email";
import { notifyNewEntry, resolveSender, sendCertificateEmail, sendDailyDigests, sendRejectionEmail, suppressionHash } from "@/server/email/notifications";
import { resendCertificateEmail } from "@/server/email/resend";
import { enqueueEmail } from "@/server/queue";
import { setStorage } from "@/server/storage";
import type { OrgContext } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

interface Sent { from: string; to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: Buffer }[] }
const sent: Sent[] = [];
const transport: EmailTransport = { send: async (m) => { sent.push(m as Sent); return { id: `re_${sent.length}_${Math.random()}` }; } };
const mem = new Map<string, Buffer>();
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32, 7)]);

let T: Awaited<ReturnType<typeof makeOrg>>;
let slug = ""; let campaignId = "";
const c = (r: "OWNER" | "EDITOR" | "VIEWER" | "ADMIN") => T.ctx(r) as OrgContext;
let n = 0;
const mobile = () => `97${String(20000000 + ++n * 11).slice(0, 8)}`;

async function issue(raw: Record<string, string>, locale = "en") {
  const r = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name: "Meera Joshi", mobile: mobile(), consent: "on", ...raw }, locale, ip: `10.2.${n}.1` });
  if (!r.ok) throw new Error(`submit failed ${r.code}`);
  const cert = await withPlatform((tx) => tx.certificate.findUnique({ where: { entryId: r.entryId } }));
  if (cert) {
    mem.set(`sq-${cert.id}`, PNG);
    await withPlatform((tx) => tx.certificate.update({ where: { id: cert.id }, data: { renderStatus: "READY", outputs: { square: { key: `sq-${cert.id}`, hash: "h", mime: "image/png" } } } }));
  }
  return { entryId: r.entryId, cert };
}

beforeAll(async () => {
  setEmailTransport(transport);
  setStorage({ put: async (k, b) => { mem.set(k, b); }, get: async (k) => mem.get(k) ?? null, delete: async (k) => { mem.delete(k); } });
  T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]);
  const camp = await createCampaign(c("EDITOR"), { name: "Diwali Drive", locale: "mr", preset: "festive" });
  campaignId = camp.id; slug = camp.slug;
  await updateCampaign(c("EDITOR"), campaignId, { status: "ACTIVE", settings: { captcha: false, duplicateMode: "allow" } });
});
afterAll(async () => {
  setEmailTransport(undefined); setStorage(undefined);
  await cleanup([T.org.id], T.members.map((m) => m.userId));
  await prisma.$disconnect();
});

describe("certificate email", () => {
  it("sends the PNG as an attachment with a tracked link to the certificate page", async () => {
    const { cert } = await issue({ email: "Meera@Example.com" });
    sent.length = 0;
    expect(await sendCertificateEmail(cert!.id)).toBe("SENT");
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toBe("meera@example.com");
    expect(m.attachments?.[0]).toMatchObject({ filename: `${cert!.number}.png` });
    expect(m.attachments![0].content.equals(PNG)).toBe(true);
    expect(m.html).toContain(`/c/${cert!.publicId}?s=email`);
    expect(m.subject).toContain("Diwali Drive");
  });
  it("is localised: Marathi contributors get a Marathi email by default", async () => {
    const { cert } = await issue({ email: "mr@example.com" }, "mr");
    sent.length = 0;
    await sendCertificateEmail(cert!.id);
    expect(sent[0].subject).toBe("तुमचे प्रमाणपत्र: Diwali Drive");
    expect(sent[0].text).toContain("नमस्कार Meera Joshi");
  });
  it("campaign-level subject and intro override the defaults, with placeholders", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow", email: { certificateSubject: { en: "Thanks {{name}} for {{campaign}}" }, certificateIntro: { en: "Your number is {{certificate_no}}." } } } });
    const { cert } = await issue({ email: "ov@example.com" });
    sent.length = 0;
    await sendCertificateEmail(cert!.id);
    expect(sent[0].subject).toBe("Thanks Meera Joshi for Diwali Drive");
    expect(sent[0].text).toContain(`Your number is ${cert!.number}.`);
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow" } });
  });
  it("is idempotent; a manual resend (force) sends again", async () => {
    const { cert } = await issue({ email: "idem@example.com" });
    sent.length = 0;
    expect(await sendCertificateEmail(cert!.id)).toBe("SENT");
    expect(await sendCertificateEmail(cert!.id)).toBe("ALREADY_SENT");
    expect(sent).toHaveLength(1);
    expect(await sendCertificateEmail(cert!.id, true)).toBe("SENT");
    expect(sent).toHaveLength(2);
  });
  it("skips contributors without an email and revoked certificates", async () => {
    const noMail = await issue({});
    expect(await sendCertificateEmail(noMail.cert!.id)).toBe("NO_EMAIL");
    const rev = await issue({ email: "rev@example.com" });
    await withPlatform((tx) => tx.certificate.update({ where: { id: rev.cert!.id }, data: { status: "REVOKED" } }));
    expect(await sendCertificateEmail(rev.cert!.id)).toBe("REVOKED");
  });
  it("never mails suppressed (bounced/complained) addresses and records why", async () => {
    await withPlatform((tx) => tx.suppression.create({ data: { emailHash: suppressionHash("blocked@example.com"), reason: "BOUNCED" } }));
    const { cert, entryId } = await issue({ email: "blocked@example.com" });
    sent.length = 0;
    expect(await sendCertificateEmail(cert!.id)).toBe("SUPPRESSED");
    expect(sent).toHaveLength(0);
    const log = await withPlatform((tx) => tx.emailLog.findFirstOrThrow({ where: { entryId } }));
    expect(log.status).toBe("SUPPRESSED");
    await withPlatform((tx) => tx.suppression.deleteMany({ where: { emailHash: suppressionHash("blocked@example.com") } }));
  });
  it("meters emails and stops at the plan limit without failing the certificate", async () => {
    const usage = () => withTenant(c("OWNER"), async (tx) => Number((await tx.usageCounter.findFirst({ where: { metric: "emails_sent" } }))?.value ?? 0));
    const before = await usage();
    expect(before).toBeGreaterThan(0);
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { emailsPerMonth: before } } } }));
    const { cert, entryId } = await issue({ email: "limit@example.com" });
    sent.length = 0;
    expect(await sendCertificateEmail(cert!.id)).toBe("SKIPPED");
    expect(sent).toHaveLength(0);
    expect((await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { id: cert!.id } }))).renderStatus).toBe("READY");
    expect((await withPlatform((tx) => tx.emailLog.findFirstOrThrow({ where: { entryId } }))).status).toBe("SKIPPED");
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
  });
  it("a failed send is logged FAILED and rethrown so the queue retries", async () => {
    const { cert, entryId } = await issue({ email: "fail@example.com" });
    setEmailTransport({ send: async () => { throw new Error("Resend down"); } });
    await expect(sendCertificateEmail(cert!.id)).rejects.toThrow("Resend down");
    setEmailTransport(transport);
    expect((await withPlatform((tx) => tx.emailLog.findFirstOrThrow({ where: { entryId } }))).status).toBe("FAILED");
    expect(await sendCertificateEmail(cert!.id)).toBe("SENT"); // retry works: FAILED does not count as sent
  });
  it("the log never stores the address, only a masked form", async () => {
    const logs = await withPlatform((tx) => tx.emailLog.findMany({ where: { orgId: T.org.id } }));
    // the local part is masked down to one character, so no real address can be reconstructed
    expect(JSON.stringify(logs)).not.toMatch(/[a-z0-9]{2,}@example\.com/i);
    expect(logs.some((l) => l.toMasked.includes("•••@example.com"))).toBe(true);
  });
  it("manual resend: needs permission, an email address and a finished render", async () => {
    const { cert } = await issue({ email: "manual@example.com" });
    await expect(resendCertificateEmail(c("VIEWER"), cert!.id)).rejects.toThrow(/Forbidden/);
    await resendCertificateEmail(c("EDITOR"), cert!.id);
    expect(enqueueEmail).toHaveBeenLastCalledWith({ kind: "certificate", id: cert!.id, force: true });
    const none = await issue({});
    await expect(resendCertificateEmail(c("EDITOR"), none.cert!.id)).rejects.toMatchObject({ code: "NO_EMAIL" });
  });
});

describe("approval and notifications", () => {
  it("rejection notice goes to the contributor; approval holds the certificate email until render", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow", approvalMode: true } });
    const r = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name: "Rejected Person", mobile: mobile(), email: "no@example.com", consent: "on" }, locale: "en", ip: "10.9.9.9" });
    const entryId = (r as { entryId: string }).entryId;
    await reviewEntry(c("EDITOR"), entryId, "REJECTED");
    expect(enqueueEmail).toHaveBeenCalledWith({ kind: "rejected", id: entryId });
    sent.length = 0;
    expect(await sendRejectionEmail(entryId)).toBe("SENT");
    expect(sent[0].subject).toBe("Update on your entry: Diwali Drive");
    expect(sent[0].attachments).toBeUndefined();
    expect(await sendRejectionEmail("00000000-0000-0000-0000-000000000000")).toBe("NO_EMAIL");
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow" } });
  });
  it("instant notifications go only to members who chose INSTANT", async () => {
    await withPlatform(async (tx) => {
      await tx.membership.updateMany({ where: { orgId: T.org.id }, data: { entryNotifications: "OFF" } });
      await tx.membership.updateMany({ where: { orgId: T.org.id, userId: T.members.find((m) => m.role === "ADMIN")!.userId }, data: { entryNotifications: "INSTANT" } });
    });
    const { entryId } = await issue({});
    sent.length = 0;
    expect(await notifyNewEntry(entryId)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("New entry");
    expect(sent[0].text).not.toMatch(/\d{10}/); // no phone numbers in notifications
  });
  it("daily digest summarises the last 24h for DAILY members only", async () => {
    await withPlatform(async (tx) => {
      await tx.membership.updateMany({ where: { orgId: T.org.id }, data: { entryNotifications: "OFF" } });
      await tx.membership.updateMany({ where: { orgId: T.org.id, userId: T.members.find((m) => m.role === "OWNER")!.userId }, data: { entryNotifications: "DAILY" } });
    });
    sent.length = 0;
    const count = await sendDailyDigests(new Date(), T.org.id); // scoped: never touch other orgs in a shared dev database
    const mine = sent.filter((m) => m.subject.includes("new entr"));
    expect(count).toBeGreaterThanOrEqual(1);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.map((m) => m.to)).toEqual(expect.arrayContaining([expect.stringContaining("owner-")]));
    await withPlatform((tx) => tx.membership.updateMany({ where: { orgId: T.org.id }, data: { entryNotifications: "OFF" } }));
    sent.length = 0;
    expect(await sendDailyDigests(new Date(), T.org.id)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("sender", () => {
  it("uses the platform sender unless the org has a verified domain AND the plan allows it", async () => {
    expect(await resolveSender(T.org.id)).toEqual({});
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { emailFrom: "certs@myngo.org", emailDomainVerified: false } }));
    expect(await resolveSender(T.org.id)).toEqual({});
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { emailDomainVerified: true } }));
    expect(await resolveSender(T.org.id)).toEqual({}); // plan does not include customEmailSender
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { features: { customEmailSender: true } } } }));
    expect((await resolveSender(T.org.id)).from).toMatch(/<certs@myngo.org>$/);
  });
});
