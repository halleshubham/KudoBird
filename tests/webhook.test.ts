import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueRenders: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform } from "@/server/db";
import { maskEmail } from "@/server/campaigns/countries";
import { handleResendEvent, verifyWebhookSignature } from "@/server/email/webhook";
import { isSuppressed } from "@/server/email/notifications";
import { POST } from "@/app/api/webhooks/resend/route";
import { cleanup, makeOrg } from "./helpers";

const SECRET = "whsec_" + Buffer.from("test-secret-key-for-svix-signing").toString("base64");
const sign = (id: string, ts: number, body: string, secret = SECRET) =>
  "v1," + createHmac("sha256", Buffer.from(secret.replace("whsec_", ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");

let T: Awaited<ReturnType<typeof makeOrg>>;
beforeAll(async () => { T = await makeOrg(); process.env.RESEND_WEBHOOK_SECRET = SECRET; });
afterAll(async () => {
  await cleanup([T.org.id], T.members.map((m) => m.userId));
  await prisma.$disconnect();
});

const logFor = async (email: string, status: "SENT" | "QUEUED" = "SENT") => {
  const providerId = `re_${randomUUID()}`;
  await withPlatform((tx) => tx.emailLog.create({ data: { orgId: T.org.id, kind: "CERTIFICATE", toMasked: maskEmail(email), status, providerId } }));
  return providerId;
};
const status = (providerId: string) => withPlatform((tx) => tx.emailLog.findUniqueOrThrow({ where: { providerId } }).then((l) => l.status));
const evt = (type: string, providerId: string, to: string, extra: object = {}) => ({ type, data: { email_id: providerId, to: [to], ...extra } });

describe("webhook signature (Svix)", () => {
  const body = JSON.stringify({ type: "email.delivered" });
  const now = Math.floor(Date.now() / 1000);
  it("accepts a correct signature, including when several are listed", () => {
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, body, SECRET)).toBe(true);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(now), signature: `v1,AAAA ${sign("msg_1", now, body)}` }, body, SECRET)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets, wrong ids, missing headers and unknown versions", () => {
    const sig = sign("msg_1", now, body);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(now), signature: sig }, body + " ", SECRET)).toBe(false);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(now), signature: sig }, body, "whsec_" + Buffer.from("other").toString("base64"))).toBe(false);
    expect(verifyWebhookSignature({ id: "msg_2", timestamp: String(now), signature: sig }, body, SECRET)).toBe(false);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(now), signature: null }, body, SECRET)).toBe(false);
    expect(verifyWebhookSignature({ id: null, timestamp: null, signature: null }, body, SECRET)).toBe(false);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(now), signature: sig.replace("v1,", "v2,") }, body, SECRET)).toBe(false);
  });
  it("rejects replayed (stale) and future-dated timestamps", () => {
    const old = now - 3600;
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(old), signature: sign("msg_1", old, body) }, body, SECRET)).toBe(false);
    expect(verifyWebhookSignature({ id: "msg_1", timestamp: String(now + 3600), signature: sign("msg_1", now + 3600, body) }, body, SECRET)).toBe(false);
  });
});

describe("webhook event handling", () => {
  it("delivered updates the log; statuses never move backwards", async () => {
    const p = await logFor("a@example.com");
    expect(await handleResendEvent(randomUUID(), evt("email.delivered", p, "a@example.com"))).toBe("applied");
    expect(await status(p)).toBe("DELIVERED");
    await handleResendEvent(randomUUID(), evt("email.sent", p, "a@example.com"));
    expect(await status(p)).toBe("DELIVERED"); // late "sent" does not regress
  });
  it("a permanent bounce marks BOUNCED and suppresses the address for every org", async () => {
    const addr = `bounce-${randomUUID()}@example.com`;
    const p = await logFor(addr);
    await handleResendEvent(randomUUID(), evt("email.bounced", p, addr, { bounce: { type: "Permanent" } }));
    expect(await status(p)).toBe("BOUNCED");
    expect(await isSuppressed(addr)).toBe(true);
    expect(await isSuppressed(addr.toUpperCase())).toBe(true);
    await handleResendEvent(randomUUID(), evt("email.delivered", p, addr)); // out of order
    expect(await status(p)).toBe("BOUNCED");
  });
  it("a transient bounce is recorded but does not suppress", async () => {
    const addr = `soft-${randomUUID()}@example.com`;
    const p = await logFor(addr);
    await handleResendEvent(randomUUID(), evt("email.bounced", p, addr, { bounce: { type: "Transient" } }));
    expect(await status(p)).toBe("BOUNCED");
    expect(await isSuppressed(addr)).toBe(false);
  });
  it("a complaint suppresses and outranks delivered", async () => {
    const addr = `spam-${randomUUID()}@example.com`;
    const p = await logFor(addr);
    await handleResendEvent(randomUUID(), evt("email.delivered", p, addr));
    await handleResendEvent(randomUUID(), evt("email.complained", p, addr));
    expect(await status(p)).toBe("COMPLAINED");
    expect(await isSuppressed(addr)).toBe(true);
  });
  it("duplicate deliveries of the same event are ignored (idempotent)", async () => {
    const p = await logFor("d@example.com");
    const id = randomUUID();
    expect(await handleResendEvent(id, evt("email.delivered", p, "d@example.com"))).toBe("applied");
    expect(await handleResendEvent(id, evt("email.delivered", p, "d@example.com"))).toBe("duplicate");
  });
  it("unknown message ids still suppress permanent bounces; irrelevant events are ignored", async () => {
    const addr = `ghost-${randomUUID()}@example.com`;
    expect(await handleResendEvent(randomUUID(), evt("email.bounced", `re_${randomUUID()}`, addr, { bounce: { type: "Permanent" } }))).toBe("unknown_email");
    expect(await isSuppressed(addr)).toBe(true);
    expect(await handleResendEvent(randomUUID(), evt("email.opened", "x", "o@example.com"))).toBe("ignored");
  });
});

describe("webhook endpoint", () => {
  const call = (body: string, headers: Record<string, string>) => POST(new NextRequest("http://localhost/api/webhooks/resend", { method: "POST", body, headers }));
  it("401 for a bad signature, 200 for a good one that updates the log", async () => {
    const p = await logFor("route@example.com");
    const body = JSON.stringify(evt("email.delivered", p, "route@example.com"));
    const ts = Math.floor(Date.now() / 1000);
    const id = `msg_${randomUUID()}`;
    expect((await call(body, { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": "v1,bad" })).status).toBe(401);
    expect(await status(p)).toBe("SENT");
    const ok = await call(body, { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": sign(id, ts, body) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ result: "applied" });
    expect(await status(p)).toBe("DELIVERED");
  });
  it("is closed (503) when no secret is configured, rather than trusting unsigned calls", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    // env() caches; emulate fresh process by re-importing the module graph
    vi.resetModules();
    const { POST: fresh } = await import("@/app/api/webhooks/resend/route");
    const res = await fresh(new NextRequest("http://localhost/api/webhooks/resend", { method: "POST", body: "{}" }));
    expect(res.status).toBe(503);
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });
});
