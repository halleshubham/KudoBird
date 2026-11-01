import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueRenders: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { NextRequest } from "next/server";
import { prisma, withPlatform, withTenant } from "@/server/db";
import { createApiKey } from "@/server/apikeys";
import { createCampaign, updateCampaign } from "@/server/campaigns/service";
import { RATE_LIMIT_PER_MINUTE } from "@/server/api/http";
import { openApiDocument } from "@/server/api/openapi";
import { decrypt } from "@/server/crypto";
import type { OrgContext } from "@/server/orgs";
import { GET as campaignsGET } from "@/app/api/v1/campaigns/route";
import { GET as campaignGET } from "@/app/api/v1/campaigns/[id]/route";
import { GET as entriesGET, POST as entriesPOST } from "@/app/api/v1/campaigns/[id]/entries/route";
import { GET as certsGET } from "@/app/api/v1/campaigns/[id]/certificates/route";
import { GET as certGET } from "@/app/api/v1/certificates/[id]/route";
import { POST as revokePOST } from "@/app/api/v1/certificates/[id]/revoke/route";
import { GET as usageGET } from "@/app/api/v1/usage/route";
import { GET as openapiGET } from "@/app/api/v1/openapi.json/route";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
let keys: { read: string; write: string; pii: string; other: string };
let campaignId = "", otherCampaignId = "";
const c = (r: "OWNER" | "ADMIN") => T.ctx(r) as OrgContext;
let n = 0; const mob = () => `91${String(70000000 + ++n * 29).slice(0, 8)}`;

type Handler = (req: NextRequest, ctx: { params: Promise<never> }) => Promise<Response>;
async function call(h: unknown, method: string, path: string, opts: { key?: string | null; body?: unknown; raw?: string; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {};
  if (opts.key !== null) headers.authorization = `Bearer ${opts.key}`;
  const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  const req = new NextRequest(`http://localhost${path}`, { method, headers, body });
  const res = await (h as Handler)(req, { params: Promise.resolve((opts.params ?? {}) as never) });
  return { status: res.status, headers: res.headers, json: (await res.json()) as any };
}

beforeAll(async () => {
  T = await makeOrg(["ADMIN"]); O = await makeOrg();
  const mkKey = async (ctx: OrgContext, scopes: string[]) => (await createApiKey(ctx, { name: scopes.join("+") + " key", scopes })).key;
  keys = { read: await mkKey(c("ADMIN"), ["read"]), write: await mkKey(c("ADMIN"), ["write"]), pii: await mkKey(c("ADMIN"), ["read", "pii"]), other: await mkKey(O.ctx("OWNER") as OrgContext, ["read", "write"]) };
  const camp = await createCampaign(c("OWNER"), { name: "API Drive", locale: "en", preset: "classic" });
  campaignId = camp.id;
  await updateCampaign(c("OWNER"), campaignId, { status: "ACTIVE", settings: { captcha: false, duplicateMode: "block" }, formFields: [{ key: "village", label: "Village", type: "text", required: true, showOnCertificate: true }] });
  otherCampaignId = (await createCampaign(O.ctx("OWNER") as OrgContext, { name: "Other Org Drive", locale: "en", preset: "minimal" })).id;
});
afterAll(async () => { await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId)); await prisma.$disconnect(); });

describe("authentication and scopes at the HTTP layer", () => {
  it("401 without a key or with a bad key, in the documented error format", async () => {
    const a = await call(campaignsGET, "GET", "/api/v1/campaigns", { key: null });
    expect(a.status).toBe(401);
    expect(a.json.error).toMatchObject({ code: "unauthorized", request_id: expect.stringMatching(/^req_/) });
    expect(a.headers.get("x-request-id")).toBe(a.json.error.request_id);
    const b = await call(campaignsGET, "GET", "/api/v1/campaigns", { key: "kb_aaaaaaaa_" + "x".repeat(43) });
    expect(b.status).toBe(401); expect(b.json.error.code).toBe("invalid_api_key");
  });
  it("a read-only key cannot write; a write key can; errors say which scope is missing", async () => {
    const r = await call(entriesPOST, "POST", "/x", { key: keys.read, params: { id: campaignId }, body: { name: "A B", mobile: mob(), consent: true, custom_fields: { village: "V" } } });
    expect(r.status).toBe(403); expect(r.json.error).toMatchObject({ code: "insufficient_scope" }); expect(r.json.error.message).toContain('"write"');
    expect((await call(revokePOST, "POST", "/x", { key: keys.read, params: { id: "whatever" } })).status).toBe(403);
  });
  it("responses are never cached and carry rate-limit headers", async () => {
    const r = await call(usageGET, "GET", "/api/v1/usage", { key: keys.read });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(Number(r.headers.get("x-ratelimit-remaining"))).toBeLessThan(RATE_LIMIT_PER_MINUTE);
  });
});

describe("reading data (tenant-scoped)", () => {
  it("lists only this organisation's campaigns, with form url and field definitions", async () => {
    const r = await call(campaignsGET, "GET", "/api/v1/campaigns", { key: keys.read });
    expect(r.status).toBe(200);
    expect(r.json.data.map((x: { id: string }) => x.id)).toEqual([campaignId]);
    expect(r.json.data[0]).toMatchObject({ name: "API Drive", status: "active", duplicate_policy: "block", form_url: expect.stringContaining(`/o/${T.org.slug}/`), custom_fields: [{ key: "village", required: true }] });
    expect(r.json.pagination).toEqual({ page: 1, per_page: 25, total: 1, total_pages: 1 });
    const theirs = await call(campaignsGET, "GET", "/api/v1/campaigns", { key: keys.other });
    expect(theirs.json.data.map((x: { id: string }) => x.id)).toEqual([otherCampaignId]);
  });
  it("another organisation's campaign is a plain 404, for every route", async () => {
    for (const [h, p] of [[campaignGET, {}], [entriesGET, {}], [certsGET, {}]] as const) {
      const r = await call(h, "GET", "/x", { key: keys.read, params: { id: otherCampaignId, ...p } });
      expect(r.status, String(h)).toBe(404); expect(r.json.error.code).toBe("not_found");
    }
    expect((await call(entriesPOST, "POST", "/x", { key: keys.write, params: { id: otherCampaignId }, body: { name: "A B", mobile: mob(), consent: true } })).status).toBe(404);
    expect((await call(campaignGET, "GET", "/x", { key: keys.read, params: { id: "not-a-uuid" } })).status).toBe(404);
  });
  it("paginates with bounded page size", async () => {
    const r = await call(campaignsGET, "GET", "/api/v1/campaigns?page=2&per_page=1000", { key: keys.read });
    expect(r.json.pagination).toMatchObject({ page: 2, per_page: 100 });
    expect(r.json.data).toEqual([]);
  });
});

describe("creating entries and certificates", () => {
  const post = (body: unknown, key = keys.write, id = campaignId) => call(entriesPOST, "POST", "/x", { key, params: { id }, body });

  it("creates an entry and issues a numbered certificate with all image links; contact is stored encrypted", async () => {
    const m = mob();
    const r = await post({ name: "Asha Rao", mobile: ` ${m.slice(0, 5)} ${m.slice(5)} `, email: "Asha@Example.com", consent: true, custom_fields: { village: "Sinnar" } });
    expect(r.status).toBe(201);
    expect(r.json.data.entry).toMatchObject({ status: "approved", duplicate: false });
    const cert = r.json.data.certificate;
    expect(cert).toMatchObject({ number: expect.stringMatching(/^AD-\d{4}-\d{5}$/), status: "active", name: "Asha Rao", render_status: "processing" });
    expect(cert.url).toContain(`/c/${cert.id}`);
    expect(Object.keys(cert.images).sort()).toEqual(["a4", "link", "pdf", "square", "story"]);
    const row = await withPlatform((tx) => tx.entry.findUniqueOrThrow({ where: { id: r.json.data.entry.id } }));
    expect(decrypt(row.mobileEnc)).toBe(`+91${m}`); expect(row.mobileEnc).not.toContain(m); expect(row.consentText).toMatch(/Collected through the API/);
    const g = await call(certGET, "GET", "/x", { key: keys.read, params: { id: cert.id } });
    expect(g.json.data.number).toBe(cert.number);
    expect((await call(certGET, "GET", "/x", { key: keys.read, params: { id: cert.number } })).json.data.id).toBe(cert.id); // by number too
    expect((await call(certGET, "GET", "/x", { key: keys.other, params: { id: cert.id } })).status).toBe(404);
  });
  it("validates like the public form and returns field-level errors (422)", async () => {
    const r = await post({ name: "", mobile: "123", email: "nope", consent: true, custom_fields: {} });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: "validation_failed", fields: { name: expect.any(String), mobile: expect.any(String), email: expect.any(String), village: expect.any(String) } });
  });
  it("requires an explicit consent confirmation and a valid language", async () => {
    expect((await post({ name: "No Consent", mobile: mob(), custom_fields: { village: "V" } })).json.error.fields).toMatchObject({ consent: "required" });
    expect((await post({ name: "No Consent", mobile: mob(), consent: "yes", custom_fields: { village: "V" } })).status).toBe(422);
    expect((await post({ name: "Bad Lang", mobile: mob(), consent: true, language: "fr", custom_fields: { village: "V" } })).json.error.fields).toMatchObject({ language: "invalid" });
  });
  it("follows the campaign's duplicate policy", async () => {
    const m = mob(); const body = { name: "Dup Person", mobile: m, consent: true, custom_fields: { village: "V" } };
    expect((await post(body)).status).toBe(201);
    const blocked = await post(body);
    expect(blocked.status).toBe(409); expect(blocked.json.error.code).toBe("duplicate_entry");
    await updateCampaign(c("OWNER"), campaignId, { settings: { captcha: false, duplicateMode: "return_existing" } });
    const again = await post(body);
    expect(again.status).toBe(200); expect(again.json.data.entry.duplicate).toBe(true); expect(again.json.data.certificate.number).toMatch(/^AD-/);
    await updateCampaign(c("OWNER"), campaignId, { settings: { captcha: false, duplicateMode: "block" } });
  });
  it("respects approval mode (no certificate yet) and refuses inactive campaigns", async () => {
    await updateCampaign(c("OWNER"), campaignId, { settings: { captcha: false, approvalMode: true } });
    const p = await post({ name: "Needs Approval", mobile: mob(), consent: true, custom_fields: { village: "V" } });
    expect(p.status).toBe(201); expect(p.json.data).toMatchObject({ entry: { status: "pending" }, certificate: null });
    await updateCampaign(c("OWNER"), campaignId, { settings: { captcha: false }, status: "CLOSED" });
    const closed = await post({ name: "Too Late", mobile: mob(), consent: true, custom_fields: { village: "V" } });
    expect(closed.status).toBe(409); expect(closed.json.error.code).toBe("campaign_not_active");
    await updateCampaign(c("OWNER"), campaignId, { settings: { captcha: false, duplicateMode: "block" }, status: "ACTIVE" });
  });
  it("stops at the plan's monthly certificate limit with a clear error and creates nothing", async () => {
    const used = await withTenant(c("OWNER"), async (tx) => Number((await tx.usageCounter.findFirst({ where: { metric: "certificates_issued" } }))?.value ?? 0));
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { certificatesPerMonth: used } } } }));
    const before = await withPlatform((tx) => tx.entry.count({ where: { campaignId } }));
    const r = await post({ name: "Over Limit", mobile: mob(), consent: true, custom_fields: { village: "V" } });
    expect(r.status).toBe(403); expect(r.json.error.code).toBe("plan_limit_reached");
    expect(await withPlatform((tx) => tx.entry.count({ where: { campaignId } }))).toBe(before);
    expect((await call(usageGET, "GET", "/x", { key: keys.read })).json.data.limits.certificatesPerMonth).toBe(used);
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
  });
  it("rejects malformed bodies", async () => {
    expect((await call(entriesPOST, "POST", "/x", { key: keys.write, params: { id: campaignId }, raw: "{ nope" })).json.error.code).toBe("invalid_json");
    expect((await call(entriesPOST, "POST", "/x", { key: keys.write, params: { id: campaignId }, raw: "[1,2]" })).status).toBe(400);
    expect((await call(entriesPOST, "POST", "/x", { key: keys.write, params: { id: campaignId }, raw: JSON.stringify({ name: "x".repeat(150_000) }) })).status).toBe(413);
  });
  it("writes are audit-logged with the key prefix (never the key)", async () => {
    const log = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "api.write" } }));
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].meta).toMatchObject({ key: expect.stringMatching(/^[a-z0-9]{8}$/), method: "POST", path: expect.stringContaining("/") });
    expect(JSON.stringify(log)).not.toMatch(/kb_[a-z0-9]{8}_/);
  });
});

describe("contact details need the pii scope", () => {
  it("entries omit mobile and email unless the key has pii", async () => {
    const plain = await call(entriesGET, "GET", "/x", { key: keys.read, params: { id: campaignId } });
    expect(plain.json.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(plain.json)).not.toMatch(/"contact"|\+91\d{10}|@example\.com/);
    const withPii = await call(entriesGET, "GET", "/x", { key: keys.pii, params: { id: campaignId } });
    const asha = withPii.json.data.find((e: { name: string }) => e.name === "Asha Rao");
    expect(asha.contact).toMatchObject({ mobile: expect.stringMatching(/^\+91\d{10}$/), email: "asha@example.com" });
  });
  it("filters by status and name, and rejects unknown statuses", async () => {
    expect((await call(entriesGET, "GET", "/x?status=pending", { key: keys.read, params: { id: campaignId } })).json.data.every((e: { status: string }) => e.status === "pending")).toBe(true);
    expect((await call(entriesGET, "GET", "/x?q=asha", { key: keys.read, params: { id: campaignId } })).json.data.map((e: { name: string }) => e.name)).toEqual(["Asha Rao"]);
    expect((await call(entriesGET, "GET", "/x?status=bogus", { key: keys.read, params: { id: campaignId } })).status).toBe(422);
  });
});

describe("revoking and usage", () => {
  it("revokes a certificate (write scope) and reports it as revoked; other orgs get 404", async () => {
    const created = await call(entriesPOST, "POST", "/x", { key: keys.write, params: { id: campaignId }, body: { name: "To Revoke", mobile: mob(), consent: true, custom_fields: { village: "V" } } });
    const id = created.json.data.certificate.id;
    expect((await call(revokePOST, "POST", "/x", { key: keys.other, params: { id }, body: {} })).status).toBe(404);
    const r = await call(revokePOST, "POST", "/x", { key: keys.write, params: { id }, body: { reason: "Issued in error" } });
    expect(r.status).toBe(200); expect(r.json.data).toMatchObject({ status: "revoked", revoke_reason: "Issued in error" });
    const list = await call(certsGET, "GET", "/x", { key: keys.read, params: { id: campaignId } });
    expect(list.json.data.find((x: { id: string }) => x.id === id).status).toBe("revoked");
  });
  it("usage shows plan, period, usage and limits", async () => {
    const r = await call(usageGET, "GET", "/api/v1/usage", { key: keys.read });
    expect(r.json.data).toMatchObject({ plan: { key: expect.any(String) }, period: expect.stringMatching(/^\d{4}-\d{2}$/), usage: { certificatesPerMonth: expect.any(Number) }, limits: expect.any(Object), features: expect.any(Object) });
  });
});

describe("rate limiting", () => {
  it(`returns 429 with Retry-After beyond ${RATE_LIMIT_PER_MINUTE} requests a minute for one key, without affecting other keys`, async () => {
    const { key } = await createApiKey(c("ADMIN"), { name: "busy key", scopes: ["read"] });
    let limited: Awaited<ReturnType<typeof call>> | undefined;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE + 3 && !limited; i++) { const r = await call(usageGET, "GET", "/x", { key }); if (r.status === 429) limited = r; }
    expect(limited?.json.error.code).toBe("rate_limited");
    expect(limited?.headers.get("retry-after")).toBeTruthy();
    expect((await call(usageGET, "GET", "/x", { key: keys.read })).status).toBe(200);
  }, 60_000);
});

describe("OpenAPI document", () => {
  it("is public, valid JSON, and describes every implemented endpoint", async () => {
    const res = await openapiGET();
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths).sort()).toEqual(["/api/v1/campaigns", "/api/v1/campaigns/{id}", "/api/v1/campaigns/{id}/certificates", "/api/v1/campaigns/{id}/entries", "/api/v1/certificates/{id}", "/api/v1/certificates/{id}/revoke", "/api/v1/usage"]);
    expect(doc.paths["/api/v1/campaigns/{id}/entries"]).toHaveProperty("post");
    expect(doc["x-webhooks"].events).toEqual(["entry.created", "certificate.issued", "certificate.revoked"]);
    expect(openApiDocument("https://x.test").servers[0].url).toBe("https://x.test");
  });
});
