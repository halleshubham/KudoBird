import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform } from "@/server/db";
import { createCampaign, submitEntry, updateCampaign } from "@/server/campaigns/service";
import { recordCertificateEvent } from "@/server/certificates/events";
import { getDashboard } from "@/server/dashboard";
import { queryAuditLog, type OrgContext } from "@/server/orgs";
import { getPublicOrg, getPublicOrgLogo } from "@/server/public-org";
import { setStorage } from "@/server/storage";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
const c = (r: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
let n = 0; const mob = () => `93${String(60000000 + ++n * 23).slice(0, 8)}`;
const UA = "Mozilla/5.0 Chrome/124";
const ids: Record<string, string> = {};

beforeAll(async () => {
  setStorage({ put: async () => {}, get: async () => Buffer.from("LOGO"), delete: async () => {} });
  T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]);
  O = await makeOrg();
  for (const [key, name, count, status] of [["big", "Big Campaign", 3, "ACTIVE"], ["small", "Small Campaign", 1, "ACTIVE"], ["draft", "Draft Campaign", 0, "DRAFT"]] as const) {
    const camp = await createCampaign(c("EDITOR"), { name, locale: "en", preset: "classic" });
    await updateCampaign(c("EDITOR"), camp.id, { status: "ACTIVE", settings: { captcha: false } });
    ids[key] = camp.id;
    for (let i = 0; i < count; i++) {
      const r = await submitEntry({ orgSlug: T.org.slug, campaignSlug: camp.slug, raw: { name: `P ${key} ${i}`, mobile: mob(), consent: "on" }, locale: "en", ip: `10.8.${n}.1` });
      const cert = await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
      await recordCertificateEvent(cert.publicId, { type: "SHARE", platform: i === 0 ? "whatsapp" : "x" }, { ip: `10.9.${n}.1`, userAgent: UA });
      await recordCertificateEvent(cert.publicId, { type: "VIEW", platform: "direct" }, { ip: `10.9.${n}.2`, userAgent: UA });
    }
    if (status === "DRAFT") await updateCampaign(c("EDITOR"), camp.id, { status: "DRAFT" });
  }
});
afterAll(async () => { setStorage(undefined); await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId)); await prisma.$disconnect(); });

describe("dashboard", () => {
  it("totals, 30-day series (today filled, gap days zero), shares by platform, top campaigns", async () => {
    const d = await getDashboard(c("VIEWER"), 30);
    expect(d.totals).toMatchObject({ certificates: 4, thisMonth: 4, entries: 4, pending: 0, views: 4, shares: 4 });
    expect(d.series).toHaveLength(30);
    expect(d.series.at(-1)).toMatchObject({ date: new Date().toISOString().slice(0, 10), count: 4 });
    expect(d.series.slice(0, -1).every((s) => s.count === 0)).toBe(true);
    expect(d.sharesByPlatform).toEqual([{ platform: "x", count: 2 }, { platform: "whatsapp", count: 2 }].sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform)).length ? expect.arrayContaining([{ platform: "x", count: 2 }, { platform: "whatsapp", count: 2 }]) : []);
    expect(d.topCampaigns.map((x) => [x.name, x.certificates])).toEqual([["Big Campaign", 3], ["Small Campaign", 1], ["Draft Campaign", 0]]);
    expect(d.topCampaigns[0]).toMatchObject({ views: 3, shares: 3 });
  });
  it("counts pending approvals", async () => {
    await updateCampaign(c("EDITOR"), ids.small, { settings: { captcha: false, approvalMode: true } });
    const slug = (await withPlatform((tx) => tx.campaign.findUniqueOrThrow({ where: { id: ids.small } }))).slug;
    await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name: "Waiting", mobile: mob(), consent: "on" }, locale: "en", ip: "10.8.99.1" });
    expect((await getDashboard(c("VIEWER"))).totals.pending).toBe(1);
  });
  it("never includes another org's numbers", async () => {
    const d = await getDashboard(O.ctx("OWNER") as OrgContext);
    expect(d.totals).toMatchObject({ certificates: 0, entries: 0, views: 0, shares: 0 });
    expect(d.topCampaigns).toEqual([]);
  });
});

describe("audit log view", () => {
  it("filters, paginates, resolves actors, and is closed to editors/viewers", async () => {
    await expect(queryAuditLog(c("EDITOR"))).rejects.toThrow(/Forbidden/);
    const all = await queryAuditLog(c("ADMIN"), { pageSize: 5 });
    expect(all.rows).toHaveLength(5);
    expect(all.total).toBeGreaterThan(5);
    const page2 = await queryAuditLog(c("ADMIN"), { pageSize: 5, page: 2 });
    expect(page2.rows.map((r) => r.id)).not.toEqual(expect.arrayContaining(all.rows.map((r) => r.id)));
    const created = await queryAuditLog(c("ADMIN"), { action: "campaign." });
    expect(created.rows.every((r) => r.action.startsWith("campaign."))).toBe(true);
    expect(created.rows[0].actorEmail).toMatch(/@test\.local$/);
    expect(all.actions).toEqual(expect.arrayContaining(["org.created", "campaign.created", "certificate.issued"]));
  });
  it("shows support (impersonation) access to the org", async () => {
    await withPlatform((tx) => tx.auditLog.create({ data: { orgId: T.org.id, actorId: T.owner.id, impersonatorId: T.members[1].userId, action: "org.updated" } }));
    const r = await queryAuditLog(c("OWNER"), { action: "org.updated" });
    expect(r.rows.find((x) => x.impersonatorId)?.impersonatorEmail).toMatch(/@test\.local$/);
  });
  it("is isolated per org", async () => {
    const other = await queryAuditLog(O.ctx("OWNER") as OrgContext);
    expect(other.rows.every((r) => r.orgId === O.org.id)).toBe(true);
  });
});

describe("public organisation page", () => {
  it("lists only ACTIVE campaigns; hides suspended orgs; serves only the chosen LOGO asset", async () => {
    const pub = await getPublicOrg(T.org.slug);
    expect(pub?.campaigns.map((x) => x.name).sort()).toEqual(["Big Campaign", "Small Campaign"]);
    expect(await getPublicOrgLogo(T.org.slug)).toBeNull();
    const logo = await withPlatform((tx) => tx.asset.create({ data: { orgId: T.org.id, kind: "LOGO", storageKey: "x", mime: "image/png", bytes: 4, filename: "l.png" } }));
    const sig = await withPlatform((tx) => tx.asset.create({ data: { orgId: T.org.id, kind: "SIGNATURE", storageKey: "y", mime: "image/png", bytes: 4, filename: "s.png" } }));
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { logoAssetId: sig.id } }));
    expect(await getPublicOrgLogo(T.org.slug)).toBeNull(); // a signature can never be published as the logo
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { logoAssetId: logo.id } }));
    expect((await getPublicOrgLogo(T.org.slug))?.mime).toBe("image/png");
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { status: "SUSPENDED" } }));
    expect(await getPublicOrg(T.org.slug)).toBeNull();
    expect(await getPublicOrgLogo(T.org.slug)).toBeNull();
    expect(await getPublicOrg("no-such-org")).toBeNull();
  });
});
