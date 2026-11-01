import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueRenders: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform, withTenant } from "@/server/db";
import { createCampaign, reviewEntry, submitEntry, updateCampaign } from "@/server/campaigns/service";
import { commitBulk } from "@/server/bulk";
import { revokeCertificate } from "@/server/certificates/issue";
import { decrypt } from "@/server/crypto";
import { consoleOutbox } from "@/server/email";
import type { OrgContext } from "@/server/orgs";
import {
  attemptDelivery, createWebhookEndpoint, deleteWebhookEndpoint, isBlockedAddress, listWebhookDeliveries, listWebhookEndpoints, processDueDeliveries, redeliverWebhook,
  rotateWebhookSecret, safeLookup, sendTestWebhook, signPayload, updateWebhookEndpoint, validateWebhookUrl, verifySignature,
} from "@/server/webhooks";
import { cleanup, makeOrg } from "./helpers";

// ---- a tiny local receiver
interface Hit { headers: IncomingMessage["headers"]; body: string }
let server: Server; let port = 0; const hits: Hit[] = [];
let respond: (res: import("node:http").ServerResponse, hit: Hit) => void = (res) => { res.statusCode = 200; res.end("ok"); };
const URL_OK = () => `http://127.0.0.1:${port}/hook`;

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
let campaignId = "", slug = "";
const c = (r: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
let n = 0; const mob = () => `92${String(80000000 + ++n * 31).slice(0, 8)}`;
const submit = (extra: Record<string, string> = {}) => submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name: "Meera Joshi", mobile: mob(), email: "meera.hook@example.com", consent: "on", ...extra }, locale: "en", ip: `10.30.${n}.1` });
const deliveriesFor = (endpointId: string) => withPlatform((tx) => tx.webhookDelivery.findMany({ where: { endpointId }, orderBy: { createdAt: "asc" } }));

beforeAll(async () => {
  server = createServer((req, res) => { let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => { const hit = { headers: req.headers, body }; hits.push(hit); respond(res, hit); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]); O = await makeOrg();
  const camp = await createCampaign(c("OWNER"), { name: "Hook Drive", locale: "en", preset: "classic" });
  campaignId = camp.id; slug = camp.slug;
  await updateCampaign(c("OWNER"), campaignId, { status: "ACTIVE", settings: { captcha: false, duplicateMode: "allow" }, formFields: [{ key: "village", label: "Village", type: "text", showOnCertificate: true }] });
});
afterAll(async () => { server.close(); delete process.env.WEBHOOK_ALLOW_LOCAL; await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId)); await prisma.$disconnect(); });
beforeEach(() => { hits.length = 0; respond = (res) => { res.statusCode = 200; res.end("ok"); }; delete process.env.WEBHOOK_ALLOW_LOCAL; });

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "ff02::1"])("blocks %s", (a) => expect(isBlockedAddress(a)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "100.63.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public address %s", (a) => expect(isBlockedAddress(a)).toBe(false));
  it("refuses anything that is not an IP", () => expect(isBlockedAddress("example.com")).toBe(true));

  it("URL validation: https only, no credentials, no private or metadata addresses", () => {
    expect(validateWebhookUrl("https://hooks.example.org/in").hostname).toBe("hooks.example.org");
    for (const bad of ["http://example.org/hook", "ftp://example.org/x", "https://user:pw@example.org/x", "https://169.254.169.254/latest/meta-data", "https://10.0.0.1/x", "https://[fd00::1]/x", "https://192.168.0.1/x", "javascript:alert(1)", "not a url", "https://" + "a".repeat(600) + ".com"]) {
      expect(() => validateWebhookUrl(bad), bad).toThrow();
    }
  });
  it("local receivers are allowed in development only (never when WEBHOOK_ALLOW_LOCAL=0 / production)", () => {
    expect(() => validateWebhookUrl("http://localhost:3999/x")).not.toThrow();
    expect(() => validateWebhookUrl("http://127.0.0.1:3999/x")).not.toThrow();
    process.env.WEBHOOK_ALLOW_LOCAL = "0";
    expect(() => validateWebhookUrl("http://localhost:3999/x")).toThrow();
    expect(() => validateWebhookUrl("https://127.0.0.1/x")).toThrow();
  });
  it("the connection-time DNS check refuses names that resolve to private addresses (rebinding-safe)", async () => {
    process.env.WEBHOOK_ALLOW_LOCAL = "0";
    const err = await new Promise<Error | null>((resolve) => safeLookup("localhost", {}, (e) => resolve(e)));
    expect(err?.message).toMatch(/Blocked/);
    delete process.env.WEBHOOK_ALLOW_LOCAL;
    const ok = await new Promise<{ e: Error | null; addr?: unknown }>((resolve) => safeLookup("localhost", {}, (e, addr) => resolve({ e, addr })));
    expect(ok.e).toBeNull();
  });
});

describe("signatures", () => {
  const secret = "whsec_testsecret";
  it("a receiver can verify what we sign", () => {
    const body = JSON.stringify({ a: 1 }); const t = Math.floor(Date.now() / 1000);
    expect(signPayload(secret, t, body)).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature(secret, signPayload(secret, t, body), body)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets, replays and malformed headers", () => {
    const body = JSON.stringify({ a: 1 }); const t = Math.floor(Date.now() / 1000); const sig = signPayload(secret, t, body);
    expect(verifySignature(secret, sig, body + " ")).toBe(false);
    expect(verifySignature("whsec_other", sig, body)).toBe(false);
    expect(verifySignature(secret, signPayload(secret, t - 3600, body), body)).toBe(false);
    for (const h of ["", "garbage", "t=1,v1=zz", `t=${t}`, null, undefined]) expect(verifySignature(secret, h as string, body)).toBe(false);
  });
});

describe("endpoint management", () => {
  it("creates an endpoint, shows the secret once and stores it encrypted", async () => {
    const { secret, endpoint } = await createWebhookEndpoint(c("ADMIN"), { url: URL_OK(), events: ["entry.created"], description: "CRM" });
    expect(secret).toMatch(/^whsec_/);
    const row = await withPlatform((tx) => tx.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } }));
    expect(row.secretEnc).not.toContain(secret); expect(decrypt(row.secretEnc)).toBe(secret);
    expect(JSON.stringify(await listWebhookEndpoints(c("ADMIN")))).not.toMatch(/secret/i);
    expect(endpoint).toMatchObject({ includePii: false, active: true });
    await deleteWebhookEndpoint(c("ADMIN"), endpoint.id);
  });
  it("validates url and events; needs the right role and plan feature", async () => {
    await expect(createWebhookEndpoint(c("ADMIN"), { url: "http://example.org/x", events: ["entry.created"] })).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(createWebhookEndpoint(c("ADMIN"), { url: URL_OK(), events: [] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createWebhookEndpoint(c("ADMIN"), { url: URL_OK(), events: ["user.deleted"] })).rejects.toMatchObject({ code: "INVALID" });
    for (const r of ["EDITOR", "VIEWER"] as const) await expect(createWebhookEndpoint(c(r), { url: URL_OK(), events: ["entry.created"] })).rejects.toThrow(/Forbidden/);
    await withPlatform((tx) => tx.organization.update({ where: { id: O.org.id }, data: { limitOverrides: { features: { webhooks: false } } } }));
    await expect(createWebhookEndpoint(O.ctx("OWNER") as OrgContext, { url: URL_OK(), events: ["entry.created"] })).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    await withPlatform((tx) => tx.organization.update({ where: { id: O.org.id }, data: { limitOverrides: {} } }));
  });
  it("update, disable/enable, rotate secret and delete; other orgs cannot touch it", async () => {
    const { endpoint, secret } = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["entry.created"] });
    const oc = O.ctx("OWNER") as OrgContext;
    await expect(updateWebhookEndpoint(oc, endpoint.id, { active: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteWebhookEndpoint(oc, endpoint.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(rotateWebhookSecret(oc, endpoint.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await updateWebhookEndpoint(c("OWNER"), endpoint.id, { events: ["entry.created", "certificate.issued"], includePii: true, description: "x" });
    await updateWebhookEndpoint(c("OWNER"), endpoint.id, { active: false });
    expect((await listWebhookEndpoints(c("OWNER"))).find((e) => e.id === endpoint.id)).toMatchObject({ active: false, includePii: true, events: ["entry.created", "certificate.issued"] });
    await updateWebhookEndpoint(c("OWNER"), endpoint.id, { active: true });
    const { secret: fresh } = await rotateWebhookSecret(c("OWNER"), endpoint.id);
    expect(fresh).not.toBe(secret);
    expect(decrypt((await withPlatform((tx) => tx.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } }))).secretEnc)).toBe(fresh);
    await deleteWebhookEndpoint(c("OWNER"), endpoint.id);
    expect((await listWebhookEndpoints(c("OWNER"))).some((e) => e.id === endpoint.id)).toBe(false);
    const audit = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: { startsWith: "webhook." } } }));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["webhook.created", "webhook.updated", "webhook.secret_rotated", "webhook.deleted"]));
    expect(JSON.stringify(audit)).not.toMatch(/whsec_/);
  });
  it("limits endpoints per organisation", async () => {
    const o = await makeOrg(); const ctx = o.ctx("OWNER") as OrgContext;
    for (let i = 0; i < 10; i++) await createWebhookEndpoint(ctx, { url: URL_OK(), events: ["entry.created"] });
    await expect(createWebhookEndpoint(ctx, { url: URL_OK(), events: ["entry.created"] })).rejects.toMatchObject({ code: "LIMIT" });
    await cleanup([o.org.id], o.members.map((m) => m.userId));
  });
});

describe("outbox: events are recorded with the change that caused them", () => {
  it("a form submission queues entry.created and certificate.issued for subscribed, active endpoints only", async () => {
    const all = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["entry.created", "certificate.issued"] });
    const onlyRevoke = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["certificate.revoked"] });
    const off = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["entry.created"] });
    await updateWebhookEndpoint(c("OWNER"), off.endpoint.id, { active: false });
    const other = await createWebhookEndpoint(O.ctx("OWNER") as OrgContext, { url: URL_OK(), events: ["entry.created", "certificate.issued"] });
    const r = await submit({ village: "Sinnar" });
    expect(r.ok).toBe(true);
    const mine = await deliveriesFor(all.endpoint.id);
    expect(mine.map((d) => d.event).sort()).toEqual(["certificate.issued", "entry.created"]);
    expect(await deliveriesFor(onlyRevoke.endpoint.id)).toHaveLength(0);
    expect(await deliveriesFor(off.endpoint.id)).toHaveLength(0);
    expect(await deliveriesFor(other.endpoint.id)).toHaveLength(0); // another org's endpoint never sees our events
    const cert = mine.find((d) => d.event === "certificate.issued")!.payload as { id: string; type: string; createdAt: string; data: { certificate: Record<string, unknown> } };
    expect(cert).toMatchObject({ type: "certificate.issued", id: expect.stringMatching(/^evt_/), data: { certificate: { number: expect.stringMatching(/^HD-/), name: "Meera Joshi", status: "active", url: expect.stringContaining("/c/"), images: { square: expect.stringContaining("/img/square") } } } });
    const entry = mine.find((d) => d.event === "entry.created")!.payload as { data: { entry: Record<string, unknown> } };
    expect(entry.data.entry).toMatchObject({ name: "Meera Joshi", status: "approved", customFields: { village: "Sinnar" }, campaignName: "Hook Drive" });
    for (const id of [all, onlyRevoke, off]) await deleteWebhookEndpoint(c("OWNER"), id.endpoint.id);
    await deleteWebhookEndpoint(O.ctx("OWNER") as OrgContext, other.endpoint.id);
  });
  it("contact details are in payloads only when the endpoint opted in", async () => {
    const plain = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["entry.created", "certificate.issued"] });
    const pii = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["entry.created", "certificate.issued"], includePii: true });
    const m = mob();
    await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name: "Private Person", mobile: m, email: "private.person@example.com", consent: "on" }, locale: "en", ip: "10.31.0.1" });
    const plainText = JSON.stringify((await deliveriesFor(plain.endpoint.id)).map((d) => d.payload));
    expect(plainText).not.toMatch(/private\.person|example\.com|\+91\d{10}|"contact"/);
    const piiRows = await deliveriesFor(pii.endpoint.id);
    expect(piiRows).toHaveLength(2);
    for (const d of piiRows) {
      expect(JSON.stringify(d.payload)).toContain(`"mobile":"+91${m}"`);
      expect(JSON.stringify(d.payload)).toContain("private.person@example.com");
    }
    await deleteWebhookEndpoint(c("OWNER"), plain.endpoint.id); await deleteWebhookEndpoint(c("OWNER"), pii.endpoint.id);
  });
  it("is atomic: if issuing fails (plan limit) no event is left behind for an entry that was rolled back", async () => {
    const ep = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["entry.created", "certificate.issued"] });
    const used = await withTenant(c("OWNER"), async (tx) => Number((await tx.usageCounter.findFirst({ where: { metric: "certificates_issued" } }))?.value ?? 0));
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { certificatesPerMonth: used } } } }));
    expect(await submit()).toMatchObject({ ok: false, code: "LIMIT" });
    expect(await deliveriesFor(ep.endpoint.id)).toHaveLength(0);
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
    await deleteWebhookEndpoint(c("OWNER"), ep.endpoint.id);
  });
  it("approval flow, revocation and bulk import all emit the right events", async () => {
    const ep = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: ["entry.created", "certificate.issued", "certificate.revoked"] });
    await updateCampaign(c("OWNER"), campaignId, { settings: { captcha: false, duplicateMode: "allow", approvalMode: true } });
    const r = await submit();
    let ev = (await deliveriesFor(ep.endpoint.id)).map((d) => d.event);
    expect(ev).toEqual(["entry.created"]); // pending: no certificate yet
    await reviewEntry(c("EDITOR"), (r as { entryId: string }).entryId, "APPROVED");
    ev = (await deliveriesFor(ep.endpoint.id)).map((d) => d.event);
    expect(ev).toEqual(["entry.created", "certificate.issued"]);
    await updateCampaign(c("OWNER"), campaignId, { settings: { captcha: false, duplicateMode: "allow" } });
    const cert = await withPlatform((tx) => tx.certificate.findFirstOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
    await revokeCertificate(c("EDITOR"), cert.id, "Issued in error");
    const rev = (await deliveriesFor(ep.endpoint.id)).find((d) => d.event === "certificate.revoked")!.payload as { data: { certificate: { status: string; revokeReason: string } } };
    expect(rev.data.certificate).toMatchObject({ status: "revoked", revokeReason: "Issued in error" });
    const before = (await deliveriesFor(ep.endpoint.id)).length;
    await commitBulk(c("EDITOR"), campaignId, `name,mobile\nBulk One,${mob()}\nBulk Two,${mob()}`, { attested: true, sendEmails: false });
    expect((await deliveriesFor(ep.endpoint.id)).length).toBe(before + 4); // 2 entries x (entry.created + certificate.issued)
    await deleteWebhookEndpoint(c("OWNER"), ep.endpoint.id);
  });
});

describe("delivery", () => {
  async function endpointWith(events = ["webhook.test" as string]) {
    const { endpoint, secret } = await createWebhookEndpoint(c("OWNER"), { url: URL_OK(), events: events.filter((e) => e !== "webhook.test").length ? events : ["entry.created"] });
    return { id: endpoint.id, secret };
  }
  const queueTest = async (id: string) => { await sendTestWebhook(c("OWNER"), id); return (await deliveriesFor(id))[0]; };

  it("POSTs a signed JSON body with identifying headers, and marks the delivery successful", async () => {
    const ep = await endpointWith(); const d = await queueTest(ep.id);
    expect(await attemptDelivery(d.id)).toBe("SUCCESS");
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.headers["content-type"]).toBe("application/json");
    expect(h.headers["x-kudobird-event"]).toBe("webhook.test");
    expect(h.headers["x-kudobird-delivery"]).toBe(d.id);
    expect(h.headers["user-agent"]).toMatch(/KudoBird/);
    expect(verifySignature(ep.secret, h.headers["x-kudobird-signature"] as string, h.body)).toBe(true);
    expect(JSON.parse(h.body)).toMatchObject({ type: "webhook.test", data: { message: expect.any(String) } });
    expect(await deliveriesFor(ep.id)).toMatchObject([{ status: "SUCCESS", attempts: 1, lastStatusCode: 200, deliveredAt: expect.any(Date) }]);
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("failures are retried with growing back-off, recorded, and end as DEAD after the last attempt", async () => {
    respond = (res) => { res.statusCode = 500; res.end("boom upstream"); };
    const ep = await endpointWith(); const d = await queueTest(ep.id);
    expect(await attemptDelivery(d.id)).toBe("FAILED");
    let row = (await deliveriesFor(ep.id))[0];
    expect(row).toMatchObject({ status: "FAILED", attempts: 1, lastStatusCode: 500 });
    expect(row.lastError).toContain("HTTP 500");
    const wait1 = row.nextAttemptAt.getTime() - Date.now();
    expect(wait1).toBeGreaterThan(30_000); expect(wait1).toBeLessThan(2 * 60_000);
    await attemptDelivery(d.id);
    row = (await deliveriesFor(ep.id))[0];
    expect(row.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(wait1); // longer second wait
    let last: string = "";
    for (let i = 0; i < 5; i++) last = await attemptDelivery(d.id);
    expect(last).toBe("DEAD");
    expect(await deliveriesFor(ep.id)).toMatchObject([{ status: "DEAD", attempts: 7 }]);
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("a later success resets the endpoint's failure streak; redelivery revives a dead delivery", async () => {
    respond = (res) => { res.statusCode = 503; res.end(); };
    const ep = await endpointWith(); const d = await queueTest(ep.id);
    await attemptDelivery(d.id);
    expect((await listWebhookEndpoints(c("OWNER"))).find((e) => e.id === ep.id)?.consecutiveFailures).toBe(1);
    respond = (res) => { res.statusCode = 204; res.end(); };
    await redeliverWebhook(c("OWNER"), d.id);
    expect(await processDueDeliveries()).toBeGreaterThanOrEqual(1);
    expect((await deliveriesFor(ep.id))[0]).toMatchObject({ status: "SUCCESS", attempts: 1 });
    expect((await listWebhookEndpoints(c("OWNER"))).find((e) => e.id === ep.id)?.consecutiveFailures).toBe(0);
    await expect(redeliverWebhook(O.ctx("OWNER") as OrgContext, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("switches an endpoint off after 20 failures in a row, audits it and emails the owners", async () => {
    respond = (res) => { res.statusCode = 500; res.end(); };
    const ep = await endpointWith();
    for (let i = 0; i < 20; i++) { await sendTestWebhook(c("OWNER"), ep.id); }
    const rows = await deliveriesFor(ep.id);
    for (const r of rows) await attemptDelivery(r.id);
    const e = (await listWebhookEndpoints(c("OWNER"))).find((x) => x.id === ep.id)!;
    expect(e).toMatchObject({ active: false, disabledReason: expect.stringContaining("20 consecutive") });
    expect((await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "webhook.auto_disabled" } }))).length).toBe(1);
    const ownerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: T.owner.id } })).email;
    // the alert email is sent after the switch-off without being awaited, so under load it can land a moment later
    await vi.waitFor(() => expect([...consoleOutbox()].some((m) => m.to === ownerEmail && /switched off/i.test(m.subject))).toBe(true), { timeout: 5000 });
    // a disabled endpoint no longer receives anything, and re-enabling resets the streak
    hits.length = 0; await sendTestWebhook(c("OWNER"), ep.id);
    expect(await attemptDelivery((await deliveriesFor(ep.id)).at(-1)!.id)).toBe("DEAD");
    expect(hits).toHaveLength(0);
    await updateWebhookEndpoint(c("OWNER"), ep.id, { active: true });
    expect((await listWebhookEndpoints(c("OWNER"))).find((x) => x.id === ep.id)).toMatchObject({ active: true, consecutiveFailures: 0, disabledReason: null });
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("does not follow redirects (a redirect could point at an internal address)", async () => {
    respond = (res) => { res.statusCode = 302; res.setHeader("location", "http://169.254.169.254/latest/meta-data"); res.end(); };
    const ep = await endpointWith(); const d = await queueTest(ep.id);
    expect(await attemptDelivery(d.id)).toBe("FAILED");
    expect(hits).toHaveLength(1); // only the original request was made
    expect((await deliveriesFor(ep.id))[0].lastError).toContain("HTTP 302");
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("refuses to deliver to private addresses when local delivery is not allowed (production behaviour)", async () => {
    const ep = await endpointWith(); const d = await queueTest(ep.id);
    process.env.WEBHOOK_ALLOW_LOCAL = "0";
    expect(await attemptDelivery(d.id)).toBe("FAILED");
    expect(hits).toHaveLength(0);
    expect((await deliveriesFor(ep.id))[0].lastError).toMatch(/not reachable|https/);
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("copes with slow, huge or garbage responses without hanging or exhausting memory", async () => {
    respond = (res) => { res.statusCode = 200; res.write("x".repeat(5_000_000)); res.end(); };
    const ep = await endpointWith(); const d = await queueTest(ep.id);
    expect(await attemptDelivery(d.id)).toBe("SUCCESS"); // 2xx is success regardless of body size; the body is capped, not stored
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("two workers polling at once deliver each event exactly once (lease)", async () => {
    const ep = await endpointWith(); await queueTest(ep.id);
    const [a, b] = await Promise.all([processDueDeliveries(), processDueDeliveries()]);
    expect(hits).toHaveLength(1);
    expect(a + b).toBeGreaterThanOrEqual(1);
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
  it("only due deliveries are sent; the delivery history is tenant-scoped", async () => {
    const ep = await endpointWith(); const d = await queueTest(ep.id);
    await withPlatform((tx) => tx.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date(Date.now() + 3600_000) } }));
    await processDueDeliveries();
    expect(hits).toHaveLength(0);
    expect((await listWebhookDeliveries(c("OWNER"), ep.id)).length).toBe(1);
    expect(await listWebhookDeliveries(O.ctx("OWNER") as OrgContext, ep.id)).toHaveLength(0);
    await deleteWebhookEndpoint(c("OWNER"), ep.id);
  });
});
