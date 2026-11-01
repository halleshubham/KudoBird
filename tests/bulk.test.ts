import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform, withTenant } from "@/server/db";
import { BULK_MAX_ROWS, bulkTemplateCsv, commitBulk, previewBulk } from "@/server/bulk";
import { createCampaign, submitEntry, updateCampaign } from "@/server/campaigns/service";
import { csvCell, parseCsv, toCsv } from "@/server/csv";
import { enqueueRender } from "@/server/queue";
import type { OrgContext } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

describe("csv", () => {
  it("parses quotes, escaped quotes, embedded newlines, CRLF, BOM and blank lines", () => {
    const t = '﻿name,note\r\n"Patil, Sunil","said ""hi""\nsecond line"\r\n\r\nplain,x\n';
    expect(parseCsv(t)).toEqual([["name", "note"], ["Patil, Sunil", 'said "hi"\nsecond line'], ["plain", "x"]]);
  });
  it("keeps Devanagari intact", () => {
    expect(parseCsv("name,mobile\nबळीराजा पाटील,9876543210")[1]).toEqual(["बळीराजा पाटील", "9876543210"]);
  });
  it("neutralises spreadsheet formula injection in every exported cell", () => {
    for (const evil of ['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) expect(csvCell(evil).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell("normal")).toBe("normal");
    expect(csvCell("+919876543210")).toBe("+919876543210"); // real phone numbers are left alone
    expect(csvCell("+91••••••0001")).toBe("+91••••••0001");
    expect(csvCell("+91 98765+cmd")).toMatch(/^'/);          // but a + followed by anything non-numeric is still neutralised
    expect(csvCell("+1+1")).toMatch(/^'/);
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(toCsv([["=1+1"]])).toContain("'=1+1");
  });
});

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
let campaignId = "";
const c = (r: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
let n = 0;
const mob = () => `95${String(40000000 + ++n * 17).slice(0, 8)}`;
const csv = (rows: string[][], header = "name,mobile,email,village") => [header, ...rows.map((r) => r.join(","))].join("\n");

beforeAll(async () => {
  T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]);
  O = await makeOrg();
  const camp = await createCampaign(c("EDITOR"), { name: "Bulk Drive", locale: "en", preset: "minimal" });
  campaignId = camp.id;
  await updateCampaign(c("EDITOR"), campaignId, { status: "ACTIVE", settings: { captcha: false, duplicateMode: "block" }, formFields: [{ key: "village", label: "Village", type: "text", showOnCertificate: true }] });
});
afterAll(async () => {
  await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId));
  await prisma.$disconnect();
});

const entryCount = () => withPlatform((tx) => tx.entry.count({ where: { campaignId } }));

describe("bulk preview", () => {
  it("classifies rows and writes nothing", async () => {
    const dup = mob();
    await submitEntry({ orgSlug: T.org.slug, campaignSlug: (await withPlatform((tx) => tx.campaign.findUniqueOrThrow({ where: { id: campaignId } }))).slug, raw: { name: "Existing Person", mobile: dup, consent: "on" }, locale: "en", ip: "10.5.0.1" });
    const before = await entryCount();
    const m1 = mob();
    const p = await previewBulk(c("EDITOR"), campaignId, csv([
      ["Asha Rao", m1, "asha@example.com", "Sinnar"],
      ["Asha Again", m1, "", ""],            // duplicate in file
      ["Existing Person", dup, "", ""],      // duplicate of an existing entry
      ["", mob(), "", ""],                   // no name
      ["Bad Mobile", "12345", "", ""],
      ["Bad Email", mob(), "not-an-email", ""],
      ["बळीराजा पाटील", mob(), "", "नांदगाव"],
    ]));
    expect(p.counts).toEqual({ ok: 2, duplicate_in_file: 1, duplicate_existing: 1, invalid: 3 });
    expect(p.willIssue).toBe(2);
    expect(p.rows.find((r) => r.line === 3)?.status).toBe("duplicate_in_file");
    expect(p.rows.find((r) => r.line === 5)?.errors.join()).toMatch(/name/);
    expect(JSON.stringify(p.rows)).not.toContain(m1); // mobiles are masked in the preview
    expect(await entryCount()).toBe(before);
  });
  it("accepts header aliases and reports unknown columns; rejects files without name/mobile", async () => {
    const p = await previewBulk(c("EDITOR"), campaignId, `Full Name,Phone,Extra\nAsha Rao,${mob()},zzz`);
    expect(p.counts.ok).toBe(1);
    expect(p.unknownColumns).toEqual(["extra"]);
    expect((await previewBulk(c("EDITOR"), campaignId, "foo,bar\n1,2")).fileError).toMatch(/name.*mobile/);
    expect((await previewBulk(c("EDITOR"), campaignId, "name,mobile")).fileError).toMatch(/at least one data row/);
  });
  it(`caps a single upload at ${BULK_MAX_ROWS} rows`, async () => {
    const rows = Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => `P${i},${mob()}`);
    expect((await previewBulk(c("EDITOR"), campaignId, ["name,mobile", ...rows].join("\n"))).fileError).toMatch(/At most/);
  });
  it("flags a file that exceeds the remaining monthly plan allowance", async () => {
    const used = await withTenant(c("OWNER"), async (tx) => Number((await tx.usageCounter.findFirst({ where: { metric: "certificates_issued" } }))?.value ?? 0));
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { certificatesPerMonth: used + 1 } } } }));
    const p = await previewBulk(c("EDITOR"), campaignId, `name,mobile\nA One,${mob()}\nB Two,${mob()}`);
    expect(p).toMatchObject({ remaining: 1, overLimit: true });
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
  });
  it("is limited to members who can manage entries, and to their own campaigns", async () => {
    await expect(previewBulk(c("VIEWER"), campaignId, "name,mobile\nA,1")).rejects.toThrow(/Forbidden/);
    await expect(previewBulk(O.ctx("OWNER") as OrgContext, campaignId, `name,mobile\nA One,${mob()}`)).rejects.toThrow(/not found/i);
  });
  it("template contains the campaign's custom field keys", () => {
    expect(bulkTemplateCsv([{ key: "village", label: "V", translations: {}, type: "text", required: false, options: [], showOnCertificate: true }]).split("\r\n")[0]).toContain("name,mobile,email,village");
  });
});

describe("bulk commit", () => {
  it("refuses without the consent attestation", async () => {
    await expect(commitBulk(c("EDITOR"), campaignId, `name,mobile\nAsha Rao,${mob()}`, { attested: false, sendEmails: false })).rejects.toMatchObject({ code: "ATTESTATION_REQUIRED" });
  });
  it("issues numbered certificates for valid rows only, re-validating server-side", async () => {
    const before = await entryCount();
    const good = [mob(), mob()];
    const r = await commitBulk(c("EDITOR"), campaignId, csv([
      ["Good One", good[0], "one@example.com", "Sinnar"],
      ["Good Two", good[1], "", ""],
      ["Bad", "000", "", ""],
      ["Dup", good[0], "", ""],
    ]), { attested: true, sendEmails: false });
    expect(r).toMatchObject({ issued: 2, failed: 0, skipped: 2 });
    expect(await entryCount()).toBe(before + 2);
    const certs = await withPlatform((tx) => tx.certificate.findMany({ where: { id: { in: r.issuedCertificateIds } }, include: { entry: true }, orderBy: { seq: "asc" } }));
    expect(certs.map((x) => x.seq)).toEqual([certs[0].seq, certs[0].seq + 1]);
    expect(certs[0].renderData).toMatchObject({ name: "Good One", village: "Sinnar" });
    expect(certs.every((x) => x.entry.status === "APPROVED" && x.renderStatus === "QUEUED")).toBe(true);
    expect(certs[0].entry.consentText).toMatch(/attested/);
    expect(enqueueRender).toHaveBeenCalledWith(certs[0].id);
  });
  it("does not email contributors unless asked; with the option, the post-render email can proceed", async () => {
    const a = await commitBulk(c("EDITOR"), campaignId, `name,mobile,email\nQuiet Person,${mob()},quiet@example.com`, { attested: true, sendEmails: false });
    const logs = await withPlatform((tx) => tx.emailLog.findMany({ where: { certificateId: a.issuedCertificateIds[0] } }));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "SKIPPED", kind: "CERTIFICATE" });
    const b = await commitBulk(c("EDITOR"), campaignId, `name,mobile,email\nLoud Person,${mob()},loud@example.com`, { attested: true, sendEmails: true });
    expect(await withPlatform((tx) => tx.emailLog.count({ where: { certificateId: b.issuedCertificateIds[0] } }))).toBe(0);
  });
  it("rejects the whole batch if it does not fit the plan, issuing nothing", async () => {
    const used = await withTenant(c("OWNER"), async (tx) => Number((await tx.usageCounter.findFirst({ where: { metric: "certificates_issued" } }))?.value ?? 0));
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { certificatesPerMonth: used + 1 } } } }));
    const before = await entryCount();
    await expect(commitBulk(c("EDITOR"), campaignId, `name,mobile\nA One,${mob()}\nB Two,${mob()}`, { attested: true, sendEmails: false })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    expect(await entryCount()).toBe(before);
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
  });
  it("is gated by the bulkIssue plan feature", async () => {
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { features: { bulkIssue: false } } } }));
    await expect(previewBulk(c("EDITOR"), campaignId, `name,mobile\nA One,${mob()}`)).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: {} } }));
  });
  it("writes an audit entry and respects roles", async () => {
    await expect(commitBulk(c("VIEWER"), campaignId, `name,mobile\nA One,${mob()}`, { attested: true, sendEmails: false })).rejects.toThrow(/Forbidden/);
    const log = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "bulk.issued" } }));
    expect(log.length).toBeGreaterThanOrEqual(3);
    expect(log[0].meta).toMatchObject({ issued: expect.any(Number) });
  });
});
