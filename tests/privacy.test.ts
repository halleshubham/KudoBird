import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform, withTenant } from "@/server/db";
import { decrypt } from "@/server/crypto";
import { createCampaign, submitEntry, updateCampaign } from "@/server/campaigns/service";
import { getPublicCertificate } from "@/server/certificates/public";
import { getWall } from "@/server/certificates/events";
import { eraseEntry, exportEntryData, purgeExpired } from "@/server/privacy";
import { exportEntriesCsv } from "@/server/exports";
import { setStorage } from "@/server/storage";
import type { OrgContext } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
let campaignId = ""; let slug = "";
const c = (r: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
const deleted: string[] = [];
let n = 0; const mob = () => `94${String(50000000 + ++n * 19).slice(0, 8)}`;
const sub = async (name: string, extra: Record<string, string> = {}) => {
  const r = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name, mobile: mob(), email: `${name.replace(/\W/g, "").toLowerCase()}@example.com`, consent: "on", ...extra }, locale: "en", ip: `10.6.${n}.1` });
  if (!r.ok) throw new Error(r.code);
  const cert = await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { entryId: r.entryId } }));
  await withPlatform((tx) => tx.certificate.update({ where: { id: cert.id }, data: { renderStatus: "READY", outputs: { square: { key: `k-${cert.id}`, hash: "h", mime: "image/png" } } } }));
  return { entryId: r.entryId, cert };
};

beforeAll(async () => {
  setStorage({ put: async () => {}, get: async () => null, delete: async (k) => { deleted.push(k); } });
  T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]);
  O = await makeOrg();
  const camp = await createCampaign(c("EDITOR"), { name: "Privacy Drive", locale: "en", preset: "classic" });
  campaignId = camp.id; slug = camp.slug;
  await updateCampaign(c("EDITOR"), campaignId, { status: "ACTIVE", settings: { captcha: false, duplicateMode: "block", wallEnabled: true }, formFields: [{ key: "village", label: "Village", type: "text", showOnCertificate: true }] });
});
afterAll(async () => { setStorage(undefined); await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId)); await prisma.$disconnect(); });

describe("data access and erasure (DPDP)", () => {
  it("export returns everything held about one person and is audited; roles enforced", async () => {
    const { entryId } = await sub("Meera Kulkarni", { village: "Sinnar", wallOptIn: "on" });
    await expect(exportEntryData(c("VIEWER"), entryId)).rejects.toThrow(/Forbidden/);
    const d = await exportEntryData(c("EDITOR"), entryId);
    expect(d).toMatchObject({ name: "Meera Kulkarni", email: "meerakulkarni@example.com", customFields: { village: "Sinnar" }, publicWallOptIn: true, certificate: { status: "ACTIVE" } });
    expect(d.mobile).toMatch(/^\+91/);
    expect(d.consentGivenAt).toBeTruthy();
    expect((await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "entry.data_exported" } }))).length).toBe(1);
    await expect(exportEntryData(O.ctx("OWNER") as OrgContext, entryId)).rejects.toThrow(/not found/i);
  });
  it("erase removes personal data irreversibly, revokes the certificate, deletes images, drops it from the wall", async () => {
    const { entryId, cert } = await sub("Erase Me", { village: "Nashik", wallOptIn: "on" });
    expect((await getWall(T.org.slug, slug))?.names).toContain("Erase Me");
    await expect(eraseEntry(c("VIEWER"), entryId)).rejects.toThrow(/Forbidden/);
    await eraseEntry(c("EDITOR"), entryId);
    const e = await withPlatform((tx) => tx.entry.findUniqueOrThrow({ where: { id: entryId } }));
    expect(e).toMatchObject({ name: "[erased]", emailEnc: null, emailHash: null, customData: {}, wallOptIn: false, ipHash: null, consentText: null });
    expect(decrypt(e.mobileEnc)).toBe("erased");
    const pub = await getPublicCertificate(cert.publicId);
    expect(pub).toMatchObject({ status: "REVOKED", name: "[erased]", outputs: {} });
    expect(JSON.stringify(await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { id: cert.id } })))).not.toMatch(/Erase Me|Nashik/);
    expect(deleted).toContain(`k-${cert.id}`);
    expect((await getWall(T.org.slug, slug))?.names).not.toContain("Erase Me");
    expect(JSON.stringify(await withPlatform((tx) => tx.emailLog.findMany({ where: { entryId } })))).not.toContain("example.com");
    const audit = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "entry.erased" } }));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("Erase Me");
  });
  it("after erasure the same mobile can register again (duplicate guard no longer matches)", async () => {
    const m = mob();
    const raw = { name: "Return Visitor", mobile: m, consent: "on" };
    const first = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw, locale: "en", ip: "10.7.0.1" });
    expect(await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw, locale: "en", ip: "10.7.0.2" })).toMatchObject({ ok: false, code: "DUPLICATE" });
    await eraseEntry(c("OWNER"), (first as { entryId: string }).entryId);
    expect(await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw, locale: "en", ip: "10.7.0.3" })).toMatchObject({ ok: true });
  });
});

describe("retention", () => {
  it("erases only entries older than the campaign's retention window, in that org", async () => {
    const old = await sub("Old Entry");
    const fresh = await sub("Fresh Entry");
    await withPlatform((tx) => tx.entry.update({ where: { id: old.entryId }, data: { createdAt: new Date(Date.now() - 100 * 86_400_000) } }));
    expect(await purgeExpired(new Date(), T.org.id)).toBe(0); // no retention configured: nothing happens
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "block", wallEnabled: true, retentionDays: 90 } });
    expect(await purgeExpired(new Date(), O.org.id)).toBe(0); // other org scope
    expect(await purgeExpired(new Date(), T.org.id)).toBe(1);
    expect((await withPlatform((tx) => tx.entry.findUniqueOrThrow({ where: { id: old.entryId } }))).name).toBe("[erased]");
    expect((await withPlatform((tx) => tx.entry.findUniqueOrThrow({ where: { id: fresh.entryId } }))).name).toBe("Fresh Entry");
    expect(await purgeExpired(new Date(), T.org.id)).toBe(0); // idempotent
    const log = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "entry.erased_retention" } }));
    expect(log).toHaveLength(1);
  });
});

describe("CSV export of entries", () => {
  it("masks contact details by default; full export needs manage permission and is audited", async () => {
    await sub("Export Person", { village: "Nashik" });
    const masked = await exportEntriesCsv(c("VIEWER"), campaignId);
    expect(masked.csv).toContain("Export Person");
    expect(masked.csv).toContain("e•••@example.com");
    expect(masked.csv).not.toMatch(/\+9194\d{8}/);
    expect(masked.csv.split("\r\n")[0]).toContain("village");
    await expect(exportEntriesCsv(c("VIEWER"), campaignId, { full: true })).rejects.toThrow(/Forbidden/);
    const full = await exportEntriesCsv(c("EDITOR"), campaignId, { full: true });
    expect(full.csv).toMatch(/\+9194\d{8}/);
    expect(full.csv).toContain("exportperson@example.com");
    expect((await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "entries.exported_full" } }))).length).toBe(1);
  });
  it("a hostile name cannot become a spreadsheet formula, and other orgs cannot export", async () => {
    await sub("=cmd|'/C calc'!A0");
    await sub("@SUM(1+1)");
    const csv = (await exportEntriesCsv(c("OWNER"), campaignId)).csv;
    expect(csv).toContain("'=cmd|'/C calc'!A0");
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).not.toMatch(/(^|,)[=@]/m); // no cell begins with a formula character
    await expect(exportEntriesCsv(O.ctx("OWNER") as OrgContext, campaignId)).rejects.toThrow(/not found/i);
  });
});
