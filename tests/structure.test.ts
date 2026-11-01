import { describe, expect, it } from "vitest";
import { paginate } from "@/server/paginate";
import { withUniqueSlug } from "@/server/slug";
import { Prisma } from "@prisma/client";

describe("paginate", () => {
  it("clamps bad input instead of producing a negative skip", () => {
    expect(paginate(0, 25)).toMatchObject({ page: 1, skip: 0, take: 25 });
    expect(paginate(-4, 25)).toMatchObject({ page: 1, skip: 0 });
    expect(paginate("abc", 25)).toMatchObject({ page: 1, skip: 0 });
    expect(paginate(undefined, 25)).toMatchObject({ page: 1, skip: 0 });
    expect(paginate(null, 25)).toMatchObject({ page: 1 });
    expect(paginate("3", 10)).toMatchObject({ page: 3, skip: 20, take: 10 });
    expect(paginate(2.9, 10)).toMatchObject({ page: 2, skip: 10 });
  });
  it("never allows a page size above the maximum or below one", () => {
    expect(paginate(1, 5000).take).toBe(100);
    expect(paginate(1, 5000, 200).take).toBe(200);
    expect(paginate(1, 0).take).toBe(1);
    expect(paginate(1, -3).take).toBe(1);
  });
});

describe("withUniqueSlug", () => {
  // Real Prisma (pg driver) reports `meta.target: null`, so the violated column can never be read from the error.
  const violation = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the (not available)", { code: "P2002", clientVersion: "6", meta: { modelName: "Organization", target: null } });
  const never = async () => false;
  it("returns the first free address untouched", async () => {
    const seen: string[] = [];
    expect(await withUniqueSlug("my-org", "organisation", async (s) => { seen.push(s); return s; }, never)).toBe("my-org");
    expect(seen).toEqual(["my-org"]);
  });
  it("retries with a short suffix when the database says the address is taken", async () => {
    const taken = new Set<string>(["my-org"]);
    const tried: string[] = [];
    const out = await withUniqueSlug("my-org", "organisation", async (s) => { tried.push(s); if (taken.has(s)) throw violation(); return s; }, async (s) => taken.has(s));
    expect(tried).toHaveLength(2);
    expect(out).toMatch(/^my-org-[0-9a-f]{4}$/);
  });
  it("rethrows a unique violation that is NOT about the address (the address is free)", async () => {
    await expect(withUniqueSlug("x", "campaign", async () => { throw violation(); }, never)).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
  it("rethrows any other error untouched", async () => {
    await expect(withUniqueSlug("x", "campaign", async () => { throw new Error("boom"); }, async () => true)).rejects.toThrow("boom");
  });
  it("gives up with a clear, user-safe error after the allowed attempts", async () => {
    let calls = 0;
    await expect(withUniqueSlug("x", "campaign", async () => { calls++; throw violation(); }, async () => true, 3)).rejects.toMatchObject({ code: "SLUG_TAKEN", message: expect.stringContaining("campaign") });
    expect(calls).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Architecture rules, enforced by reading the source. They exist because these invariants are security properties, and
// "remember to" is not a control. If one fails, fix the code; only extend an allow-list with a reviewed reason.
// ---------------------------------------------------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : []; });
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const files = walk(ROOT);

describe("architecture rules", () => {
  it("pages, actions and components never import the database module (they go through src/server services)", () => {
    const allowed = new Set(["app/api/health/route.ts"]); // liveness probe: SELECT 1
    const offenders = files.filter((f) => rel(f).startsWith("app/") || rel(f).startsWith("components/")).filter((f) => !allowed.has(rel(f))).filter((f) => /from "@\/server\/db"/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("only a short list of modules may decrypt: pii.ts (contact details), auth.ts (2FA secrets), webhooks.ts (signing secrets)", () => {
    const allowed = new Set(["server/crypto.ts", "server/pii.ts", "server/auth.ts", "server/webhooks.ts"]);
    const offenders = files.filter((f) => !allowed.has(rel(f))).filter((f) => /\bdecrypt\b/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, ""))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("every service function that takes an org context checks a permission itself", () => {
    const missing: string[] = [];
    for (const f of files.filter((x) => rel(x).startsWith("server/"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/export (?:async )?function (\w+)\(\s*ctx: (?:OrgContext|RoleContext)/g)) {
        const tail = src.slice(m.index! + m[0].length);
        const next = tail.search(/\nexport |\n\/\/ -{5,}/);
        const body = src.slice(m.index!, m.index! + m[0].length + (next === -1 ? tail.length : next));
        if (!body.includes("assertCan(")) missing.push(`${rel(f)}:${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("slug-retry loops live in withUniqueSlug only", () => {
    const offenders = files.filter((f) => rel(f) !== "server/slug.ts").filter((f) => /attempt === 0 \? base/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("form actions share one error mapper (no local `const fail = (e` copies)", () => {
    const offenders = files.filter((f) => /const fail = \(e: unknown\)\s*(:[^=]+)?=>\s*\{/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
});
