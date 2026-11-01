import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Prisma } from "@prisma/client";
import * as React from "react";
import { audit } from "./audit";
import { decrypt, encrypt } from "./crypto";
import { withPlatform, withTenant, type Tx } from "./db";
import { deliver } from "./email/notifications";
import { ActionEmail } from "./email/templates";
import { assertFeature } from "./entitlements";
import { env } from "./env";
import { OrgError, type OrgContext } from "./orgs";
import { assertCan } from "./permissions";

export const WEBHOOK_EVENTS = ["entry.created", "certificate.issued", "certificate.revoked"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "webhook.test";

const MAX_ENDPOINTS = 10;
const MAX_ATTEMPTS = 7;
/** Retry schedule after a failed attempt (minutes). 7 attempts over about a day, then the delivery is marked DEAD. */
const BACKOFF_MIN = [1, 5, 30, 120, 360, 1440];
const AUTO_DISABLE_AFTER = 20;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 16 * 1024;

// ------------------------------------------------------------------ SSRF protection

/** True for addresses a webhook must never be sent to: loopback, private, link-local (cloud metadata), CGNAT, multicast, etc. */
export function isBlockedAddress(addr: string): boolean {
  const v = net.isIP(addr);
  if (v === 4) {
    const [a, b] = addr.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = addr.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); // IPv4-mapped IPv6
    if (mapped) return isBlockedAddress(mapped[1]);
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("64:ff9b") || x.startsWith("2001:db8");
  }
  return true; // not an IP at all: refuse
}

/** Development and tests may deliver to a local receiver; production never. */
const allowLocal = () => env().NODE_ENV !== "production" && process.env.WEBHOOK_ALLOW_LOCAL !== "0";
const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";

export function validateWebhookUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new OrgError("INVALID_URL", "Enter a full URL such as https://example.org/hooks/kudobird"); }
  if (raw.length > 500) throw new OrgError("INVALID_URL", "URL is too long");
  if (u.username || u.password) throw new OrgError("INVALID_URL", "Do not put credentials in the URL");
  const local = isLocalHost(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local && allowLocal())) throw new OrgError("INVALID_URL", "Webhook URLs must use https");
  if (local && !allowLocal()) throw new OrgError("INVALID_URL", "That address is not reachable from the public internet");
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && !local && isBlockedAddress(u.hostname.replace(/^\[|\]$/g, ""))) throw new OrgError("INVALID_URL", "That address is not reachable from the public internet");
  return u;
}

/**
 * DNS lookup used for the actual connection. Validating inside the lookup that the socket uses (instead of resolving once
 * up front) closes the DNS-rebinding window: the address we check is the address we connect to.
 */
export function safeLookup(hostname: string, _opts: unknown, cb: (err: Error | null, address?: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const permitted = addrs.filter((a) => !isBlockedAddress(a.address) || (allowLocal() && (a.address === "127.0.0.1" || a.address === "::1")));
    if (permitted.length === 0) return cb(new Error("Blocked: destination resolves to a private or reserved address"));
    cb(null, permitted[0].address, permitted[0].family);
  });
}

// ------------------------------------------------------------------ signing

export const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** What a receiver should run: constant-time check of `X-KudoBird-Signature` plus a freshness window against replays. */
export function verifySignature(secret: string, header: string | null | undefined, body: string, toleranceSec = 300, now = Date.now()): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ------------------------------------------------------------------ endpoints (org side)

const publicEndpoint = (e: { id: string; url: string; description: string | null; events: string[]; includePii: boolean; active: boolean; consecutiveFailures: number; disabledAt: Date | null; disabledReason: string | null; createdAt: Date }) =>
  ({ id: e.id, url: e.url, description: e.description, events: e.events, includePii: e.includePii, active: e.active, consecutiveFailures: e.consecutiveFailures, disabledAt: e.disabledAt, disabledReason: e.disabledReason, createdAt: e.createdAt });

function cleanEvents(events: string[]): string[] {
  const list = [...new Set(events)];
  if (list.length === 0 || list.some((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))) throw new OrgError("INVALID", "Choose at least one valid event");
  return list;
}

export async function createWebhookEndpoint(ctx: OrgContext, input: { url: string; events: string[]; description?: string; includePii?: boolean }) {
  assertCan(ctx.role, "apikeys.manage");
  const url = validateWebhookUrl(input.url).toString();
  const events = cleanEvents(input.events);
  const secret = newSecret();
  const row = await withTenant(ctx, async (tx) => {
    await assertFeature(tx, ctx.orgId, "webhooks");
    if ((await tx.webhookEndpoint.count({ where: { orgId: ctx.orgId } })) >= MAX_ENDPOINTS) throw new OrgError("LIMIT", `At most ${MAX_ENDPOINTS} webhook endpoints per organisation`);
    const e = await tx.webhookEndpoint.create({ data: { orgId: ctx.orgId, url, events, description: input.description?.slice(0, 120) || null, includePii: !!input.includePii, secretEnc: encrypt(secret) } });
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "webhook.created", entity: "WebhookEndpoint", entityId: e.id, meta: { url, events, includePii: !!input.includePii } });
    return e;
  });
  return { secret, endpoint: publicEndpoint(row) }; // the signing secret is shown once
}

export async function listWebhookEndpoints(ctx: OrgContext) {
  assertCan(ctx.role, "apikeys.manage");
  return (await withTenant(ctx, (tx) => tx.webhookEndpoint.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } }))).map(publicEndpoint);
}

export async function updateWebhookEndpoint(ctx: OrgContext, id: string, patch: { url?: string; events?: string[]; description?: string; includePii?: boolean; active?: boolean }) {
  assertCan(ctx.role, "apikeys.manage");
  const data: Record<string, unknown> = {};
  if (patch.url !== undefined) data.url = validateWebhookUrl(patch.url).toString();
  if (patch.events !== undefined) data.events = cleanEvents(patch.events);
  if (patch.description !== undefined) data.description = patch.description.slice(0, 120) || null;
  if (patch.includePii !== undefined) data.includePii = patch.includePii;
  if (patch.active !== undefined) Object.assign(data, patch.active ? { active: true, disabledAt: null, disabledReason: null, consecutiveFailures: 0 } : { active: false });
  await withTenant(ctx, async (tx) => {
    const e = await tx.webhookEndpoint.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!e) throw new OrgError("NOT_FOUND", "Webhook not found");
    await tx.webhookEndpoint.update({ where: { id }, data });
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "webhook.updated", entity: "WebhookEndpoint", entityId: id, meta: { changed: Object.keys(data) } });
  });
}

export async function rotateWebhookSecret(ctx: OrgContext, id: string) {
  assertCan(ctx.role, "apikeys.manage");
  const secret = newSecret();
  await withTenant(ctx, async (tx) => {
    const r = await tx.webhookEndpoint.updateMany({ where: { id, orgId: ctx.orgId }, data: { secretEnc: encrypt(secret) } });
    if (!r.count) throw new OrgError("NOT_FOUND", "Webhook not found");
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "webhook.secret_rotated", entity: "WebhookEndpoint", entityId: id });
  });
  return { secret };
}

export async function deleteWebhookEndpoint(ctx: OrgContext, id: string) {
  assertCan(ctx.role, "apikeys.manage");
  await withTenant(ctx, async (tx) => {
    const r = await tx.webhookEndpoint.deleteMany({ where: { id, orgId: ctx.orgId } });
    if (!r.count) throw new OrgError("NOT_FOUND", "Webhook not found");
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "webhook.deleted", entity: "WebhookEndpoint", entityId: id });
  });
}

export async function listWebhookDeliveries(ctx: OrgContext, endpointId: string, take = 20) {
  assertCan(ctx.role, "apikeys.manage");
  return withTenant(ctx, (tx) => tx.webhookDelivery.findMany({ where: { orgId: ctx.orgId, endpointId }, orderBy: { createdAt: "desc" }, take, select: { id: true, event: true, status: true, attempts: true, lastStatusCode: true, lastError: true, createdAt: true, deliveredAt: true, nextAttemptAt: true } }));
}

/** Queue a fresh attempt now (also resurrects DEAD deliveries). */
export async function redeliverWebhook(ctx: OrgContext, deliveryId: string) {
  assertCan(ctx.role, "apikeys.manage");
  await withTenant(ctx, async (tx) => {
    const r = await tx.webhookDelivery.updateMany({ where: { id: deliveryId, orgId: ctx.orgId }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
    if (!r.count) throw new OrgError("NOT_FOUND", "Delivery not found");
  });
}

export async function sendTestWebhook(ctx: OrgContext, endpointId: string) {
  assertCan(ctx.role, "apikeys.manage");
  await withTenant(ctx, async (tx) => {
    const e = await tx.webhookEndpoint.findFirst({ where: { id: endpointId, orgId: ctx.orgId } });
    if (!e) throw new OrgError("NOT_FOUND", "Webhook not found");
    await tx.webhookDelivery.create({ data: { orgId: ctx.orgId, endpointId, event: "webhook.test", payload: envelope("webhook.test", { message: "This is a test event from KudoBird." }) } });
  });
}

// ------------------------------------------------------------------ outbox (producers)

export const envelope = (type: string, data: Record<string, unknown>): Prisma.InputJsonObject => ({ id: `evt_${randomBytes(12).toString("base64url")}`, type, createdAt: new Date().toISOString(), data: data as Prisma.InputJsonObject });

/**
 * Writes one delivery row per subscribed endpoint INSIDE the caller's transaction (transactional outbox): the event exists
 * if and only if the change that caused it committed. `build(includePii)` is only called for the variants that are needed.
 */
export async function queueWebhookEventTx(tx: Tx, orgId: string, event: Exclude<WebhookEvent, "webhook.test">, build: (includePii: boolean) => Promise<Record<string, unknown>>): Promise<number> {
  const endpoints = await tx.webhookEndpoint.findMany({ where: { orgId, active: true, events: { has: event } } });
  if (endpoints.length === 0) return 0;
  const cache = new Map<boolean, Record<string, unknown>>();
  for (const ep of endpoints) {
    if (!cache.has(ep.includePii)) cache.set(ep.includePii, await build(ep.includePii));
    await tx.webhookDelivery.create({ data: { orgId, endpointId: ep.id, event, payload: envelope(event, cache.get(ep.includePii) ?? {}) } });
  }
  return endpoints.length;
}

// ------------------------------------------------------------------ delivery (worker side)

interface HttpResult { status: number; body: string }

function postJson(url: URL, headers: Record<string, string>, body: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(body) }, lookup: safeLookup as never, timeout: TIMEOUT_MS }, (res) => {
      // Redirects are NOT followed: a redirect could point to an internal address.
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size <= MAX_RESPONSE_BYTES) chunks.push(c); else res.destroy(); });
      res.on("close", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 200) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)));
    req.on("error", reject);
    req.end(body);
  });
}

/** Attempt one delivery. Never throws: the outcome is recorded on the row. Returns the resulting status. */
export async function attemptDelivery(deliveryId: string): Promise<"SUCCESS" | "FAILED" | "DEAD" | "SKIPPED"> {
  const d = await withPlatform((tx) => tx.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } }));
  if (!d) return "SKIPPED";
  if (!d.endpoint.active) {
    await withPlatform((tx) => tx.webhookDelivery.update({ where: { id: d.id }, data: { status: "DEAD", lastError: "Endpoint is disabled" } }));
    return "DEAD";
  }
  const body = JSON.stringify(d.payload);
  const ts = Math.floor(Date.now() / 1000);
  let status = 0, error: string | null = null;
  try {
    const url = validateWebhookUrl(d.endpoint.url); // re-validated every time: settings or policy may have changed
    const res = await postJson(url, {
      "content-type": "application/json", "user-agent": "KudoBird-Webhooks/1", "x-kudobird-event": d.event, "x-kudobird-delivery": d.id,
      "x-kudobird-signature": signPayload(decrypt(d.endpoint.secretEnc), ts, body),
    }, body);
    status = res.status;
    if (status < 200 || status >= 300) error = `HTTP ${status}${res.body ? `: ${res.body.replace(/\s+/g, " ").slice(0, 120)}` : ""}`;
  } catch (e) {
    error = (e instanceof Error ? e.message : "Request failed").slice(0, 200);
  }
  const attempts = d.attempts + 1;
  if (!error) {
    await withPlatform(async (tx) => {
      await tx.webhookDelivery.update({ where: { id: d.id }, data: { status: "SUCCESS", attempts, lastStatusCode: status, lastError: null, deliveredAt: new Date() } });
      if (d.endpoint.consecutiveFailures > 0) await tx.webhookEndpoint.update({ where: { id: d.endpointId }, data: { consecutiveFailures: 0 } });
    });
    return "SUCCESS";
  }
  const dead = attempts >= MAX_ATTEMPTS;
  const next = new Date(Date.now() + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] ?? 1440) * 60_000);
  const disabled = await withPlatform(async (tx) => {
    await tx.webhookDelivery.update({ where: { id: d.id }, data: { status: dead ? "DEAD" : "FAILED", attempts, lastStatusCode: status || null, lastError: error, nextAttemptAt: next } });
    const ep = await tx.webhookEndpoint.update({ where: { id: d.endpointId }, data: { consecutiveFailures: { increment: 1 } } });
    // A receiver that has been failing continuously is switched off instead of being hammered forever.
    if (ep.consecutiveFailures >= AUTO_DISABLE_AFTER && ep.active) {
      await tx.webhookEndpoint.update({ where: { id: ep.id }, data: { active: false, disabledAt: new Date(), disabledReason: `Disabled automatically after ${AUTO_DISABLE_AFTER} consecutive failed deliveries` } });
      await audit(tx, { orgId: d.orgId, action: "webhook.auto_disabled", entity: "WebhookEndpoint", entityId: ep.id, meta: { url: ep.url } });
      return ep;
    }
    return null;
  });
  if (disabled) await alertOwners(d.orgId, disabled.url).catch((e) => console.error("[webhooks] alert failed", e));
  return dead ? "DEAD" : "FAILED";
}

async function alertOwners(orgId: string, url: string) {
  const owners = await withPlatform((tx) => tx.membership.findMany({ where: { orgId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true } }));
  for (const o of owners) {
    await deliver({
      orgId, kind: "WEBHOOK_ALERT", to: o.user.email, contributor: false, subject: "A webhook endpoint was switched off",
      react: React.createElement(ActionEmail, { preview: "Webhook switched off", heading: "A webhook endpoint was switched off", body: `${url} failed ${AUTO_DISABLE_AFTER} deliveries in a row, so KudoBird stopped sending to it. Fix the receiver, then re-enable it under Developers.`, actionLabel: "Open Developers", actionUrl: new URL("/app/developers", env().APP_URL).toString() }),
    });
  }
}

/**
 * Worker entry point. Claims due deliveries with a short lease (so several workers never send the same one twice),
 * then attempts each. The lease also protects against a worker dying mid-attempt: the row simply becomes due again.
 */
export async function processDueDeliveries(limit = 50): Promise<number> {
  const due = await withPlatform((tx) => tx.webhookDelivery.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, take: limit, select: { id: true, nextAttemptAt: true } }));
  let done = 0;
  for (const row of due) {
    const claimed = await withPlatform((tx) => tx.webhookDelivery.updateMany({ where: { id: row.id, nextAttemptAt: row.nextAttemptAt, status: { in: ["PENDING", "FAILED"] } }, data: { nextAttemptAt: new Date(Date.now() + 2 * 60_000) } }));
    if (claimed.count !== 1) continue; // another worker got it
    await attemptDelivery(row.id);
    done++;
  }
  return done;
}
