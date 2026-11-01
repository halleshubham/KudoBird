import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { createCampaign, updateCampaign } from "@/server/campaigns/service";
import { normalizeOrigin, parseSettings } from "@/server/campaigns/schema";
import { embedSnippets } from "@/lib/embed";
import { GET as policyGET } from "@/app/api/embed-policy/route";
import { config as mwConfig, middleware } from "@/middleware";
import nextConfig from "../next.config";
import type { OrgContext } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
let slug = ""; let campaignId = "";
const c = () => T.ctx("OWNER") as OrgContext;

beforeAll(async () => {
  T = await makeOrg();
  const camp = await createCampaign(c(), { name: "Embed Drive", locale: "en", preset: "classic" });
  slug = camp.slug; campaignId = camp.id;
});
afterAll(async () => { vi.unstubAllGlobals(); await cleanup([T.org.id], T.members.map((m) => m.userId)); await prisma.$disconnect(); });

describe("allowed embedding sites", () => {
  it("normalises to a bare origin", () => {
    expect(normalizeOrigin("https://WWW.MyNGO.org/")).toBe("https://www.myngo.org");
    expect(normalizeOrigin(" https://myngo.org:8443 ")).toBe("https://myngo.org:8443");
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it.each(["http://myngo.org", "https://myngo.org/page", "https://myngo.org?x=1", "https://*.myngo.org", "javascript:alert(1)", "ftp://myngo.org", "myngo.org", "https://user:pw@myngo.org", "", "https://myngo.org/#frag"])("rejects %j", (bad) => {
    expect(() => normalizeOrigin(bad)).toThrow();
    expect(() => parseSettings({ embedOrigins: [bad] })).toThrow();
  });
  it("settings keep a list (max 10) and default to nobody", () => {
    expect(parseSettings({}).embedOrigins).toEqual([]);
    expect(parseSettings({ embedOrigins: ["https://a.org/", "https://b.org"] }).embedOrigins).toEqual(["https://a.org", "https://b.org"]);
    expect(() => parseSettings({ embedOrigins: Array.from({ length: 11 }, (_, i) => `https://s${i}.org`) })).toThrow();
  });
});

describe("embed policy endpoint", () => {
  const ask = async (org: string, campaign: string) => (await policyGET(new NextRequest(`http://localhost/api/embed-policy?org=${org}&campaign=${campaign}`))).json() as Promise<{ origins: string[] }>;
  it("returns the allow-list only for active campaigns, and nothing else about them", async () => {
    await updateCampaign(c(), campaignId, { settings: { captcha: false, embedOrigins: ["https://www.myngo.org"], approvalMode: true, retentionDays: 90 } });
    expect(await ask(T.org.slug, slug)).toEqual({ origins: [] }); // still a draft
    await updateCampaign(c(), campaignId, { status: "ACTIVE" });
    const body = await ask(T.org.slug, slug);
    expect(body).toEqual({ origins: ["https://www.myngo.org"] }); // no approval mode, retention or anything else leaks
  });
  it("unknown campaigns and missing parameters get an empty list", async () => {
    expect(await ask(T.org.slug, "nope")).toEqual({ origins: [] });
    expect(await ask("", "")).toEqual({ origins: [] });
  });
});

describe("framing policy (middleware)", () => {
  const run = (url = `http://localhost/embed/o/${T?.org.slug}/${slug}`) => middleware(new NextRequest(url));
  const csp = async (url?: string) => (await run(url)).headers.get("content-security-policy");

  it("permits exactly the listed sites to frame the form", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ origins: ["https://www.myngo.org", "https://partner.example"] })));
    expect(await csp()).toBe("frame-ancestors https://www.myngo.org https://partner.example");
  });
  it("forbids framing entirely when no site is listed", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ origins: [] })));
    expect(await csp()).toBe("frame-ancestors 'none'");
  });
  it("fails closed when the policy lookup fails or returns junk", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    expect(await csp()).toBe("frame-ancestors 'none'");
    vi.stubGlobal("fetch", async () => new Response("<html>oops</html>", { status: 500 }));
    expect(await csp()).toBe("frame-ancestors 'none'");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ origins: ["https://x.org"] }), { status: 500 }));
    expect(await csp()).toBe("frame-ancestors 'none'");
  });
  it("only runs for /embed routes and also sets basic hardening headers", async () => {
    expect(mwConfig.matcher).toEqual(["/embed/:path*"]);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ origins: [] })));
    const res = await run();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
  it("everything else in the app can only be framed by itself", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    expect(rule.headers.find((h) => h.key === "Content-Security-Policy")?.value).toBe("frame-ancestors 'self'");
    const re = new RegExp(`^${rule.source.replace(/\(\?!embed\/\)/, "(?!embed/)")}$`);
    for (const p of ["/login", "/app", "/c/abc", "/o/demo/camp", "/admin", "/api/v1/campaigns"]) expect(re.test(p), p).toBe(true);
    expect(re.test("embed/o/demo/camp")).toBe(false); // the embed route is excluded (handled by the middleware instead)
    expect(re.test("/embed/o/demo/camp".slice(1))).toBe(false);
  });
});

describe("snippets and the loader script", () => {
  it("generates iframe and script snippets with safely encoded names", () => {
    const s = embedSnippets("https://certs.example.org", "my-ngo", "diwali-2026", "mr");
    expect(s.url).toBe("https://certs.example.org/embed/o/my-ngo/diwali-2026?lang=mr");
    expect(s.iframe).toContain(`src="${s.url}"`);
    expect(s.script).toBe('<script src="https://certs.example.org/embed.js" data-org="my-ngo" data-campaign="diwali-2026" data-lang="mr" async></script>');
    expect(embedSnippets("https://x.org", "a b", "c/d").url).toBe("https://x.org/embed/o/a%20b/c%2Fd");
  });
  it("embed.js only trusts resize messages from its own frame and clamps the height", () => {
    const js = readFileSync(path.join(__dirname, "..", "public", "embed.js"), "utf8");
    expect(js).toContain("e.origin !== origin");
    expect(js).toContain("e.source !== f.contentWindow");
    expect(js).toMatch(/d\.height\s*>\s*100\s*&&\s*d\.height\s*<\s*5000/);
    expect(js).toContain("encodeURIComponent(org)");
  });
  it("embed.js actually runs: builds the right iframe and resizes it only for genuine messages", () => {
    const listeners: Array<(e: unknown) => void> = []; const inserted: Record<string, unknown>[] = [];
    const frame: Record<string, any> = { style: {}, setAttribute() {}, contentWindow: { id: "frame" } };
    const script = { src: "https://certs.example.org/embed.js", getAttribute: (k: string) => ({ "data-org": "my-ngo", "data-campaign": "diwali", "data-lang": "mr" } as Record<string, string>)[k], parentNode: { insertBefore: (el: Record<string, unknown>) => inserted.push(el) }, nextSibling: null };
    const sandbox = { document: { currentScript: script, createElement: () => frame }, window: { addEventListener: (_: string, fn: (e: unknown) => void) => listeners.push(fn) }, URL, encodeURIComponent, console };
    new Function(...Object.keys(sandbox), readFileSync(path.join(__dirname, "..", "public", "embed.js"), "utf8"))(...Object.values(sandbox));
    expect(frame.src).toBe("https://certs.example.org/embed/o/my-ngo/diwali?lang=mr");
    expect(inserted).toEqual([frame]);
    const msg = (origin: string, source: unknown, d: unknown) => listeners[0]({ origin, source, data: d });
    msg("https://evil.example", frame.contentWindow, { type: "kudobird:resize", height: 900 });
    msg("https://certs.example.org", { id: "other-window" }, { type: "kudobird:resize", height: 900 });
    msg("https://certs.example.org", frame.contentWindow, { type: "kudobird:resize", height: 99999 });
    expect(frame.style.height).toBeUndefined(); // all three ignored: the frame was not resized
    msg("https://certs.example.org", frame.contentWindow, { type: "kudobird:resize", height: 812.4 });
    expect(frame.style.height).toBe("813px");
  });
});
