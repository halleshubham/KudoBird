import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { audit } from "../audit";
import { ApiAuthError, authenticateApiKey, hasScope, type ApiPrincipal, type ApiScope } from "../apikeys";
import { withTenant } from "../db";
import { EntitlementError } from "../entitlements";
import { OrgError, type OrgContext } from "../orgs";
import { ForbiddenError } from "../permissions";
import { rateLimit } from "../security/ratelimit";

export const RATE_LIMIT_PER_MINUTE = 300;
const MAX_BODY_BYTES = 100_000;

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly fields?: Record<string, string>) { super(message); }
}

export interface ApiCall<P = Record<string, string>> {
  req: NextRequest; params: P; principal: ApiPrincipal;
  /** Org context for the service layer. Write keys act as Editors, read-only keys as Viewers. */
  ctx: OrgContext;
  query: URLSearchParams;
  json: () => Promise<Record<string, unknown>>;
}

const errorBody = (code: string, message: string, requestId: string, fields?: Record<string, string>) => ({ error: { code, message, ...(fields ? { fields } : {}), request_id: requestId } });

/** Wraps a handler with authentication, scope check, per-key rate limiting, uniform JSON errors and an audit entry for writes. */
export function api<P = Record<string, string>>(scope: ApiScope, fn: (c: ApiCall<P>) => Promise<{ status?: number; body: unknown }>) {
  return async (req: NextRequest, route: { params: Promise<P> }): Promise<NextResponse> => {
    const requestId = `req_${randomBytes(8).toString("hex")}`;
    const headers: Record<string, string> = { "x-request-id": requestId, "cache-control": "no-store" };
    const fail = (status: number, code: string, message: string, fields?: Record<string, string>) => NextResponse.json(errorBody(code, message, requestId, fields), { status, headers });
    try {
      const principal = await authenticateApiKey(req.headers.get("authorization"));
      const rl = await rateLimit(`api:${principal.keyId}`, RATE_LIMIT_PER_MINUTE, 60);
      headers["x-ratelimit-limit"] = String(RATE_LIMIT_PER_MINUTE);
      headers["x-ratelimit-remaining"] = String(rl.remaining);
      if (!rl.allowed) {
        const r = fail(429, "rate_limited", `Too many requests. Limit: ${RATE_LIMIT_PER_MINUTE} per minute per key.`);
        r.headers.set("retry-after", "30");
        return r;
      }
      if (!hasScope(principal, scope)) return fail(403, "insufficient_scope", `This key needs the "${scope}" scope for this request`);
      const ctx: OrgContext = { orgId: principal.orgId, userId: principal.createdById, role: hasScope(principal, "write") ? "EDITOR" : "VIEWER" };
      const call: ApiCall<P> = {
        req, params: await route.params, principal, ctx, query: req.nextUrl.searchParams,
        json: async () => {
          const text = await req.text();
          if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Request body is too large");
          try { const v = JSON.parse(text || "{}"); if (!v || typeof v !== "object" || Array.isArray(v)) throw 0; return v as Record<string, unknown>; }
          catch { throw new ApiError(400, "invalid_json", "The request body must be a JSON object"); }
        },
      };
      const out = await fn(call);
      const status = out.status ?? 200;
      if (req.method !== "GET" && status < 400) {
        await withTenant(ctx, (tx) => audit(tx, { orgId: ctx.orgId, actorId: principal.createdById, action: "api.write", entity: "ApiKey", entityId: principal.keyId, meta: { key: principal.keyPrefix, method: req.method, path: req.nextUrl.pathname, status } }));
      }
      return NextResponse.json(out.body, { status, headers });
    } catch (e) {
      if (e instanceof ApiAuthError) return fail(e.status, e.code, e.message);
      if (e instanceof ApiError) return fail(e.status, e.code, e.message, e.fields);
      if (e instanceof ForbiddenError) return fail(403, "forbidden", "This key is not allowed to do that");
      if (e instanceof EntitlementError) return fail(403, e.code === "LIMIT_REACHED" ? "plan_limit_reached" : "feature_not_available", e.message);
      if (e instanceof OrgError) return fail(e.code === "NOT_FOUND" ? 404 : 400, e.code === "NOT_FOUND" ? "not_found" : e.code.toLowerCase(), e.message);
      if (e instanceof ZodError) return fail(422, "validation_failed", e.issues[0]?.message ?? "Invalid input");
      console.error("[api] unhandled", requestId, e);
      return fail(500, "internal_error", "Something went wrong. Quote the request id if you contact support.");
    }
  };
}

/** `page` / `per_page` query parsing with sane bounds. */
export function pageParams(q: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(q.get("page"))) || 1);
  const perPage = Math.min(100, Math.max(1, Math.floor(Number(q.get("per_page"))) || 25));
  return { page, perPage };
}
export const pagination = (page: number, perPage: number, total: number) => ({ page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) });
