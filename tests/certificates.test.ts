import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform, withTenant } from "@/server/db";
import { createCampaign, getCampaign, getTemplateDesign, reviewEntry, saveTemplateDesign, submitEntry, updateCampaign } from "@/server/campaigns/service";
import { regenerateCertificate, restoreCertificate, revokeCertificate } from "@/server/certificates/issue";
import { getPublicCertificate } from "@/server/certificates/public";
import { enqueueRender } from "@/server/queue";
import type { OrgContext } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
let campaignId = "";
let slug = "";
const c = (r: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
const ip = () => `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let n = 0;
const mobile = () => `98${String(10000000 + ++n * 7).slice(0, 8)}`;
const submit = (extra: Record<string, string> = {}, s = slug) =>
  submitEntry({ orgSlug: T.org.slug, campaignSlug: s, raw: { name: "Priya Kulkarni", mobile: mobile(), email: "priya.private@example.com", consent: "on", ...extra }, locale: "en", ip: ip() });

beforeAll(async () => {
  T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]);
  O = await makeOrg();
  const camp = await createCampaign(c("EDITOR"), { name: "Sant Jnaneshwar Abhiyan", locale: "en", preset: "classic" });
  campaignId = camp.id; slug = camp.slug;
  await updateCampaign(c("EDITOR"), campaignId, {
    status: "ACTIVE",
    settings: { captcha: false, duplicateMode: "allow" },
    formFields: [{ key: "village", label: "Village", type: "text", showOnCertificate: true }, { key: "secret_note", label: "Note", type: "text", showOnCertificate: false }],
  });
});
afterAll(async () => {
  await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId));
  await prisma.$disconnect();
});

describe("certificate issuing", () => {
  it("issues a numbered certificate immediately for auto-approved entries and queues rendering", async () => {
    const r = await submit({ village: "Sinnar" });
    expect(r).toMatchObject({ ok: true, status: "APPROVED" });
    const cert = await withPlatform((tx) => tx.certificate.findFirstOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
    expect(cert.number).toBe(`SJA-${new Date().getFullYear()}-00001`);
    expect(cert.renderStatus).toBe("QUEUED");
    expect(enqueueRender).toHaveBeenCalledWith(cert.id);
  });
  it("snapshot contains only certificate fields: never mobile, email or hidden custom fields", async () => {
    const r = await submit({ village: "Nashik", secret_note: "hidden-value" });
    const cert = await withPlatform((tx) => tx.certificate.findFirstOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
    const json = JSON.stringify(cert.renderData);
    expect(cert.renderData).toMatchObject({ name: "Priya Kulkarni", village: "Nashik", certificate_no: cert.number });
    for (const secret of ["priya.private", "example.com", "hidden-value", "98"]) expect(json).not.toContain(secret);
    const pub = JSON.stringify(await getPublicCertificate(cert.publicId));
    for (const secret of ["priya.private", "example.com", "mobile", "email", "Enc", "Hash"]) expect(pub).not.toContain(secret);
  });
  it("numbers are unique and gap-free under concurrent submissions", async () => {
    const before = await withPlatform((tx) => tx.certificate.count({ where: { campaignId } }));
    const rs = await Promise.all(Array.from({ length: 12 }, () => submit()));
    expect(rs.every((x) => x.ok)).toBe(true);
    const all = await withPlatform((tx) => tx.certificate.findMany({ where: { campaignId }, select: { seq: true, number: true, publicId: true } }));
    expect(all.length).toBe(before + 12);
    expect(new Set(all.map((x) => x.number)).size).toBe(all.length);
    expect(all.map((x) => x.seq).sort((a, b) => a - b)).toEqual(all.map((_, i) => i + 1));
  });
  it("public ids are long, random and unique", async () => {
    const all = await withPlatform((tx) => tx.certificate.findMany({ where: { campaignId }, select: { publicId: true } }));
    expect(new Set(all.map((x) => x.publicId)).size).toBe(all.length);
    for (const { publicId } of all) expect(publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  it("duplicate submit (return_existing) hands back the same certificate", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "return_existing" } });
    const raw = { name: "Dup Person", mobile: mobile(), consent: "on" };
    const a = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw, locale: "en", ip: ip() });
    const b = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw, locale: "en", ip: ip() });
    expect(b).toMatchObject({ ok: true, duplicate: true, certificateId: (a as { certificateId: string }).certificateId });
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow" } });
  });
  it("approval mode: no certificate until approved; approving issues exactly one", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow", approvalMode: true } });
    const r = await submit();
    expect(r).toMatchObject({ ok: true, status: "PENDING", certificateId: undefined });
    const entryId = (r as { entryId: string }).entryId;
    expect(await withPlatform((tx) => tx.certificate.count({ where: { entryId } }))).toBe(0);
    await reviewEntry(c("EDITOR"), entryId, "APPROVED");
    await reviewEntry(c("EDITOR"), entryId, "APPROVED"); // idempotent
    expect(await withPlatform((tx) => tx.certificate.count({ where: { entryId } }))).toBe(1);
    const rej = await submit();
    await reviewEntry(c("EDITOR"), (rej as { entryId: string }).entryId, "REJECTED");
    expect(await withPlatform((tx) => tx.certificate.count({ where: { entryId: (rej as { entryId: string }).entryId } }))).toBe(0);
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow" } });
  });
  it("metering counts issued certificates and the monthly plan limit stops issuing", async () => {
    const usage = () => withTenant(c("OWNER"), async (tx) => Number((await tx.usageCounter.findFirst({ where: { metric: "certificates_issued" } }))?.value ?? 0));
    const used = await usage();
    expect(used).toBeGreaterThanOrEqual(15);
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { certificatesPerMonth: used } } } }));
    const before = await withPlatform((tx) => tx.entry.count({ where: { campaignId } }));
    expect(await submit()).toMatchObject({ ok: false, code: "LIMIT" });
    expect(await withPlatform((tx) => tx.entry.count({ where: { campaignId } }))).toBe(before); // nothing half-created
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
  });
});

describe("versioning, revoke, regenerate", () => {
  it("editing the template does not change already-issued certificates; regenerate(latest) opts in", async () => {
    const r = await submit();
    const cert = await withPlatform((tx) => tx.certificate.findFirstOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
    const camp = await getCampaign(c("EDITOR"), campaignId);
    const d = (await getTemplateDesign(c("EDITOR"), camp.templateId!)).design;
    d.blocks.title.text = "Brand new title";
    await saveTemplateDesign(c("EDITOR"), camp.templateId!, d);
    const after = await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { id: cert.id } }));
    expect(after.templateVersionId).toBe(cert.templateVersionId);
    await regenerateCertificate(c("EDITOR"), cert.id, false);
    expect((await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { id: cert.id } }))).templateVersionId).toBe(cert.templateVersionId);
    await regenerateCertificate(c("EDITOR"), cert.id, true);
    expect((await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { id: cert.id } }))).templateVersionId).not.toBe(cert.templateVersionId);
  });
  it("revoke marks the certificate revoked on the public record and re-renders; restore undoes it", async () => {
    const r = await submit();
    const cert = await withPlatform((tx) => tx.certificate.findFirstOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
    await expect(revokeCertificate(c("VIEWER"), cert.id, "x")).rejects.toThrow(/Forbidden/);
    await revokeCertificate(c("EDITOR"), cert.id, "Issued in error");
    const pub = await getPublicCertificate(cert.publicId);
    expect(pub).toMatchObject({ status: "REVOKED", renderStatus: "QUEUED" });
    expect(enqueueRender).toHaveBeenLastCalledWith(cert.id, true);
    await restoreCertificate(c("EDITOR"), cert.id);
    expect((await getPublicCertificate(cert.publicId))?.status).toBe("ACTIVE");
    const log = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: { startsWith: "certificate." } } }));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["certificate.issued", "certificate.revoked", "certificate.restored", "certificate.regenerated"]));
  });
  it("another org cannot revoke or regenerate this org's certificates, nor see them", async () => {
    const cert = await withPlatform((tx) => tx.certificate.findFirstOrThrow({ where: { campaignId } }));
    const o = O.ctx("OWNER") as OrgContext;
    await expect(revokeCertificate(o, cert.id)).rejects.toThrow(/not found/i);
    await expect(regenerateCertificate(o, cert.id)).rejects.toThrow(/not found/i);
    expect(await withTenant(o, (tx) => tx.certificate.count())).toBe(0);
  });
  it("unknown or malformed public ids return nothing", async () => {
    expect(await getPublicCertificate("nope")).toBeNull();
    expect(await getPublicCertificate("A".repeat(22))).toBeNull();
    expect(await getPublicCertificate("../../etc/passwd")).toBeNull();
  });
});
