import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withPlatform, withTenant } from "@/server/db";
import { ApiAuthError, authenticateApiKey, createApiKey, generateKey, KEY_FORMAT, listApiKeys, revokeApiKey } from "@/server/apikeys";
import { hashToken } from "@/server/crypto";
import type { OrgContext } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
const c = (r: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
const bearer = (k: string) => `Bearer ${k}`;
const mk = (scopes = ["read"], name = "CI key") => createApiKey(c("ADMIN"), { name, scopes });

beforeAll(async () => { T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]); O = await makeOrg(); });
afterAll(async () => { await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId)); await prisma.$disconnect(); });

describe("key generation and storage", () => {
  it("keys have a public prefix and a high-entropy secret; every key is different", () => {
    const keys = Array.from({ length: 200 }, () => generateKey());
    for (const k of keys) { expect(k.key).toMatch(KEY_FORMAT); expect(KEY_FORMAT.exec(k.key)![1]).toBe(k.prefix); }
    expect(new Set(keys.map((k) => k.key)).size).toBe(200);
    expect(new Set(keys.map((k) => k.prefix)).size).toBeGreaterThan(195);
  });
  it("shows the full key once; the database holds only a hash", async () => {
    const { key, record } = await mk(["read", "write"]);
    expect(key).toMatch(KEY_FORMAT);
    const row = await withPlatform((tx) => tx.apiKey.findUniqueOrThrow({ where: { id: record.id } }));
    expect(row.keyHash).toBe(hashToken(key));
    expect(JSON.stringify(row)).not.toContain(key.split("_")[2]); // the secret part is nowhere in the row
    expect(JSON.stringify(await listApiKeys(c("ADMIN")))).not.toMatch(/keyHash|kb_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/);
    expect(record).toMatchObject({ name: "CI key", scopes: ["read", "write"], revokedAt: null });
  });
  it("write implies read; unknown or empty scopes are refused; names are required", async () => {
    expect((await mk(["write"])).record.scopes.sort()).toEqual(["read", "write"]);
    await expect(createApiKey(c("ADMIN"), { name: "x1", scopes: [] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createApiKey(c("ADMIN"), { name: "x1", scopes: ["admin"] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createApiKey(c("ADMIN"), { name: " ", scopes: ["read"] })).rejects.toMatchObject({ code: "INVALID" });
  });
  it("only owners and admins manage keys, and every change is audited", async () => {
    for (const r of ["EDITOR", "VIEWER"] as const) {
      await expect(createApiKey(c(r), { name: "nope", scopes: ["read"] })).rejects.toThrow(/Forbidden/);
      await expect(listApiKeys(c(r))).rejects.toThrow(/Forbidden/);
    }
    const { record } = await createApiKey(c("OWNER"), { name: "owner key", scopes: ["read"] });
    await revokeApiKey(c("OWNER"), record.id);
    const log = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: { startsWith: "apikey." } } }));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["apikey.created", "apikey.revoked"]));
    expect(JSON.stringify(log)).not.toMatch(/kb_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/);
  });
  it("keys are tenant-scoped: another org cannot list or revoke them", async () => {
    const { record } = await mk();
    expect((await listApiKeys(O.ctx("OWNER") as OrgContext)).map((k) => k.id)).not.toContain(record.id);
    await expect(revokeApiKey(O.ctx("OWNER") as OrgContext, record.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("is gated by the api plan feature", async () => {
    await withPlatform((tx) => tx.organization.update({ where: { id: O.org.id }, data: { limitOverrides: { features: { api: false } } } }));
    await expect(createApiKey(O.ctx("OWNER") as OrgContext, { name: "blocked", scopes: ["read"] })).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    await withPlatform((tx) => tx.organization.update({ where: { id: O.org.id }, data: { limitOverrides: {} } }));
  });
  it("caps active keys per organisation (revoked keys do not count)", async () => {
    const o = await makeOrg(); 
    const ctx = o.ctx("OWNER") as OrgContext;
    const made = [];
    for (let i = 0; i < 20; i++) made.push((await createApiKey(ctx, { name: `k${i}x`, scopes: ["read"] })).record.id);
    await expect(createApiKey(ctx, { name: "one too many", scopes: ["read"] })).rejects.toMatchObject({ code: "LIMIT" });
    await revokeApiKey(ctx, made[0]);
    await expect(createApiKey(ctx, { name: "fits now", scopes: ["read"] })).resolves.toBeTruthy();
    await cleanup([o.org.id], o.members.map((m) => m.userId));
  });
});

describe("authentication", () => {
  it("accepts a valid key and reports its org, scopes and key id; updates lastUsedAt", async () => {
    const { key, record } = await mk(["read", "pii"]);
    const p = await authenticateApiKey(bearer(key));
    expect(p).toMatchObject({ orgId: T.org.id, keyId: record.id, keyPrefix: record.prefix, scopes: ["read", "pii"] });
    expect((await withPlatform((tx) => tx.apiKey.findUniqueOrThrow({ where: { id: record.id } }))).lastUsedAt).not.toBeNull();
    expect((await authenticateApiKey(`bearer   ${key}`)).keyId).toBe(record.id); // scheme is case-insensitive
  });
  it("rejects missing, malformed, unknown and wrong-secret keys with the same error (no probing)", async () => {
    const { key } = await mk();
    const wrongSecret = key.slice(0, -1) + (key.endsWith("A") ? "B" : "A");
    const unknown = generateKey().key;
    const errs: ApiAuthError[] = [];
    for (const h of [bearer(wrongSecret), bearer(unknown), bearer("garbage"), "Basic abc", "Bearer", bearer(`kb_${randomUUID().slice(0, 8)}_short`)]) {
      const e = await authenticateApiKey(h).catch((x) => x);
      expect(e).toBeInstanceOf(ApiAuthError);
      errs.push(e);
    }
    expect(errs[0].message).toBe(errs[1].message); // wrong secret and unknown key are indistinguishable
    expect(errs[0].code).toBe("invalid_api_key");
    await expect(authenticateApiKey(undefined)).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });
  it("rejects revoked and expired keys", async () => {
    const a = await mk(); await revokeApiKey(c("ADMIN"), a.record.id);
    await expect(authenticateApiKey(bearer(a.key))).rejects.toMatchObject({ code: "invalid_api_key" });
    const b = await mk(); await withPlatform((tx) => tx.apiKey.update({ where: { id: b.record.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    await expect(authenticateApiKey(bearer(b.key))).rejects.toMatchObject({ code: "invalid_api_key" });
  });
  it("stops working when the organisation is suspended or loses API access", async () => {
    const { key } = await mk();
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { status: "SUSPENDED" } }));
    await expect(authenticateApiKey(bearer(key))).rejects.toMatchObject({ status: 403, code: "organisation_inactive" });
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { status: "ACTIVE", limitOverrides: { features: { api: false } } } }));
    await expect(authenticateApiKey(bearer(key))).rejects.toMatchObject({ status: 403, code: "api_not_available" });
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
    await expect(authenticateApiKey(bearer(key))).resolves.toMatchObject({ orgId: T.org.id });
  });
  it("a key can only ever act inside its own organisation", async () => {
    const other = await createApiKey(O.ctx("OWNER") as OrgContext, { name: "other org", scopes: ["read"] });
    expect((await authenticateApiKey(bearer(other.key))).orgId).toBe(O.org.id);
  });
});
