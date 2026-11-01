import { randomBytes, timingSafeEqual } from "node:crypto";
import { actorOf, audit } from "./audit";
import { hashToken } from "./crypto";
import { withPlatform, withTenant } from "./db";
import { assertFeature, effectiveEntitlements } from "./entitlements";
import { OrgError, type OrgContext } from "./orgs";
import { assertCan } from "./permissions";

export const API_SCOPES = ["read", "write", "pii"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
const MAX_KEYS = 20;

export class ApiAuthError extends Error {
  constructor(public readonly status: 401 | 403, public readonly code: string, message: string) { super(message); }
}

const PREFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const newPrefix = () => Array.from(randomBytes(8), (b) => PREFIX_CHARS[b % PREFIX_CHARS.length]).join("");

/** Keys look like kb_<8 chars>_<43 chars>. The prefix is public (shown in the UI and used for lookup); the rest is secret. */
export function generateKey(): { key: string; prefix: string } {
  const prefix = newPrefix();
  return { key: `kb_${prefix}_${randomBytes(32).toString("base64url")}`, prefix };
}

export const KEY_FORMAT = /^kb_([a-z0-9]{8})_[A-Za-z0-9_-]{43}$/;

export async function createApiKey(ctx: OrgContext, input: { name: string; scopes: string[]; expiresInDays?: number | null }) {
  assertCan(ctx.role, "apikeys.manage");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) throw new OrgError("INVALID", "Give the key a name (2 to 60 characters)");
  const scopes = [...new Set(input.scopes)].filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s));
  if (scopes.length === 0 || scopes.length !== new Set(input.scopes).size) throw new OrgError("INVALID", "Choose at least one valid scope");
  if (scopes.includes("write") && !scopes.includes("read")) scopes.push("read"); // writing implies reading
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
  const { key, prefix } = generateKey();
  const row = await withTenant(ctx, async (tx) => {
    await assertFeature(tx, ctx.orgId, "api");
    if ((await tx.apiKey.count({ where: { orgId: ctx.orgId, revokedAt: null } })) >= MAX_KEYS) throw new OrgError("LIMIT", `An organisation can have at most ${MAX_KEYS} active API keys`);
    const k = await tx.apiKey.create({ data: { orgId: ctx.orgId, name, prefix, keyHash: hashToken(key), scopes, createdById: ctx.userId, expiresAt } });
    await audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "apikey.created", entity: "ApiKey", entityId: k.id, meta: { name, prefix, scopes } });
    return k;
  });
  return { key, record: publicKey(row) }; // the full key is returned exactly once
}

const publicKey = (k: { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) =>
  ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, revokedAt: k.revokedAt, createdAt: k.createdAt });

export async function listApiKeys(ctx: OrgContext) {
  assertCan(ctx.role, "apikeys.manage");
  return (await withTenant(ctx, (tx) => tx.apiKey.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } }))).map(publicKey);
}

export async function revokeApiKey(ctx: OrgContext, id: string) {
  assertCan(ctx.role, "apikeys.manage");
  await withTenant(ctx, async (tx) => {
    const k = await tx.apiKey.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!k) throw new OrgError("NOT_FOUND", "API key not found");
    if (!k.revokedAt) {
      await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "apikey.revoked", entity: "ApiKey", entityId: id, meta: { name: k.name, prefix: k.prefix } });
    }
  });
}

export interface ApiPrincipal { orgId: string; keyId: string; keyPrefix: string; scopes: ApiScope[]; createdById: string }

/** Authenticates `Authorization: Bearer kb_...`. Same error for unknown/wrong keys so key prefixes cannot be probed. */
export async function authenticateApiKey(authorization: string | null | undefined): Promise<ApiPrincipal> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m) throw new ApiAuthError(401, "unauthorized", "Send your API key as: Authorization: Bearer <key>");
  const key = m[1];
  const parsed = KEY_FORMAT.exec(key);
  const bad = new ApiAuthError(401, "invalid_api_key", "The API key is invalid, expired or revoked");
  if (!parsed) throw bad;
  const row = await withPlatform((tx) => tx.apiKey.findUnique({ where: { prefix: parsed[1] }, include: { org: { select: { status: true, deletedAt: true, limitOverrides: true, plan: { select: { limits: true, features: true } } } } } }));
  const given = Buffer.from(hashToken(key)), expected = Buffer.from(row?.keyHash ?? "0".repeat(64));
  const ok = given.length === expected.length && timingSafeEqual(given, expected); // constant time, also when the key does not exist
  if (!row || !ok || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) throw bad;
  if (row.org.deletedAt || row.org.status !== "ACTIVE") throw new ApiAuthError(403, "organisation_inactive", "This organisation is suspended");
  // Plan and overrides came with the key lookup (one query per request instead of three).
  if (!effectiveEntitlements(row.org.plan, row.org.limitOverrides).features.api) throw new ApiAuthError(403, "api_not_available", "API access is not included in this organisation's plan");
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await withPlatform((tx) => tx.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }));
  }
  return { orgId: row.orgId, keyId: row.id, keyPrefix: row.prefix, scopes: row.scopes as ApiScope[], createdById: row.createdById };
}

export const hasScope = (p: ApiPrincipal, scope: ApiScope) => p.scopes.includes(scope);
