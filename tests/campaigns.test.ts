import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueRenders: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform, withTenant } from "@/server/db";
import { decrypt } from "@/server/crypto";
import {
  createCampaign, createSignatory, getCampaign, getTemplateDesign, listEntries, reviewEntry, revealEntryContact, saveTemplateDesign,
  setCampaignSignatories, submitEntry, updateCampaign, cloneTemplate,
} from "@/server/campaigns/service";
import { setCaptcha } from "@/server/security/captcha";
import { lastOtp, setOtpProvider } from "@/server/security/otp";
import { sendOtp, verifyOtp } from "@/server/security/otp";
import sharp from "sharp";
import { uploadAsset } from "@/server/assets";
import { getStorage } from "@/server/storage";
import { setStorage } from "@/server/storage";
import { presetDesign } from "@/server/render/presets";
import { cleanup, makeOrg } from "./helpers";
import type { OrgContext } from "@/server/orgs";
import { randomUUID } from "node:crypto";

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
let campaignId: string;
let slug: string;
const c = (r: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
const ip = () => `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const form = (mobile: string, extra: Record<string, string> = {}) => ({ name: "Aarav Sharma", mobile, consent: "on", ...extra });
const submit = (raw: Record<string, string>, extra: object = {}) =>
  submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw, locale: "en", ip: ip(), ...extra });

beforeAll(async () => {
  setStorage({ put: async () => {}, get: async () => Buffer.from("x"), delete: async () => {} });
  T = await makeOrg(["ADMIN", "EDITOR", "VIEWER"]);
  O = await makeOrg();
  const camp = await createCampaign(c("EDITOR"), { name: "Sant Jnaneshwar Abhiyan", locale: "mr", preset: "festive" });
  campaignId = camp.id;
  slug = camp.slug;
  await updateCampaign(c("EDITOR"), campaignId, { status: "ACTIVE", settings: { captcha: false } });
});
afterAll(async () => {
  setCaptcha(undefined);
  await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((m) => m.userId));
  await prisma.$disconnect();
});

describe("campaigns & roles", () => {
  it("derives a certificate number prefix and starts from a Devanagari preset", async () => {
    const camp = await getCampaign(c("VIEWER"), campaignId);
    expect(camp.numberPrefix).toBe("SJA");
    const d = await getTemplateDesign(c("VIEWER"), camp.templateId!);
    expect(d.design.blocks.title.font).toBe("Noto Serif Devanagari");
  });
  it("editors manage campaigns; viewers cannot; only admins manage signatories", async () => {
    await expect(createCampaign(c("VIEWER"), { name: "x y", locale: "en", preset: "classic" })).rejects.toThrow(/Forbidden/);
    await expect(createSignatory(c("EDITOR"), { name: "A", designation: "B" })).rejects.toThrow(/Forbidden/);
    await expect(createSignatory(c("ADMIN"), { name: "Dr. Mehta", designation: "Chairperson" })).resolves.toBeTruthy();
  });
  it("campaign limit comes from the entitlement service", async () => {
    await withPlatform((tx) => tx.organization.update({ where: { id: O.org.id }, data: { limitOverrides: { limits: { campaigns: 1 } } } }));
    const oc = O.ctx("OWNER") as OrgContext;
    await createCampaign(oc, { name: "First one", locale: "en", preset: "classic" });
    await expect(createCampaign(oc, { name: "Second one", locale: "en", preset: "classic" })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });
  it("signatories are ordered per campaign and cannot come from another org", async () => {
    const mine = await createSignatory(c("ADMIN"), { name: "Second", designation: "Secretary" });
    const theirs = await createSignatory(O.ctx("OWNER") as OrgContext, { name: "Foreign", designation: "X" });
    const all = await withTenant(c("OWNER"), (tx) => tx.signatory.findMany({ where: { orgId: T.org.id }, orderBy: { createdAt: "asc" } }));
    await setCampaignSignatories(c("EDITOR"), campaignId, [mine.id, theirs.id, all[0].id]);
    const camp = await getCampaign(c("VIEWER"), campaignId);
    expect(camp.signatories.map((s) => s.signatory.name)).toEqual(["Second", "Dr. Mehta"]);
  });
});

describe("template versioning", () => {
  it("each save is a new immutable version; old versions stay readable", async () => {
    const camp = await getCampaign(c("EDITOR"), campaignId);
    const tid = camp.templateId!;
    const v1 = await getTemplateDesign(c("EDITOR"), tid);
    const edited = structuredClone(v1.design);
    edited.blocks.title.text = "Changed";
    const { version } = await saveTemplateDesign(c("EDITOR"), tid, edited);
    expect(version).toBe(v1.version + 1);
    expect((await getTemplateDesign(c("EDITOR"), tid)).design.blocks.title.text).toBe("Changed");
    expect((await getTemplateDesign(c("EDITOR"), tid, v1.version)).design.blocks.title.text).toBe(v1.design.blocks.title.text);
  });
  it("viewers cannot save; invalid designs are rejected", async () => {
    const camp = await getCampaign(c("EDITOR"), campaignId);
    await expect(saveTemplateDesign(c("VIEWER"), camp.templateId!, presetDesign("classic"))).rejects.toThrow(/Forbidden/);
    await expect(saveTemplateDesign(c("EDITOR"), camp.templateId!, { nope: 1 })).rejects.toThrow();
  });
  it("global templates are readable and clonable but not editable, and another org's are invisible", async () => {
    const g = await withPlatform(async (tx) => {
      const t = await tx.template.create({ data: { orgId: null, name: "Global classic", preset: "classic" } });
      await tx.templateVersion.create({ data: { templateId: t.id, orgId: null, version: 1, design: presetDesign("classic") as object } });
      return t;
    });
    const copy = await cloneTemplate(c("EDITOR"), g.id);
    expect(copy.orgId).toBe(T.org.id);
    await expect(saveTemplateDesign(c("EDITOR"), g.id, presetDesign("classic"))).rejects.toThrow(/not found/i);
    await expect(withTenant(c("EDITOR"), (tx) => tx.template.update({ where: { id: g.id }, data: { name: "hacked" } }))).rejects.toThrow();
    const otherSees = await withTenant(O.ctx("OWNER"), (tx) => tx.template.findMany({ where: { orgId: T.org.id } }));
    expect(otherSees).toHaveLength(0);
    await withPlatform((tx) => tx.template.delete({ where: { id: g.id } }));
  });
});

describe("tenant isolation for stage 2 tables", () => {
  it("another org sees none of the campaigns, entries, signatories or assets", async () => {
    await submit(form("9000000001"));
    const o = O.ctx("OWNER");
    await withTenant(o, async (tx) => {
      expect((await tx.campaign.findMany({ where: { orgId: T.org.id } })).length).toBe(0);
      expect(await tx.entry.count({ where: { orgId: T.org.id } })).toBe(0);
      expect(await tx.signatory.count({ where: { orgId: T.org.id } })).toBe(0);
      expect(await tx.campaignSignatory.count()).toBe(0);
    });
    await expect(withTenant(o, (tx) => tx.entry.create({ data: { orgId: T.org.id, campaignId, name: "x", mobileEnc: "x", mobileHash: "x" } }))).rejects.toThrow();
    await expect(getCampaign(o as OrgContext, campaignId)).rejects.toThrow(/not found/i);
  });
});

describe("public submission", () => {
  it("stores contact details encrypted and masks them in lists", async () => {
    const r = await submit(form("9111111111", { email: "Aarav@Example.com" }));
    expect(r).toMatchObject({ ok: true, status: "APPROVED", duplicate: false });
    const row = await withPlatform((tx) => tx.entry.findFirstOrThrow({ where: { campaignId, name: "Aarav Sharma", emailHash: { not: null } } }));
    expect(row.mobileEnc).not.toContain("9111111111");
    expect(decrypt(row.mobileEnc)).toBe("+919111111111");
    const list = await listEntriesFor(c("VIEWER"));
    expect(list.rows.find((x) => x.id === row.id)).toMatchObject({ mobileMasked: "+91••••••1111", emailMasked: "a•••@example.com" });
    expect(JSON.stringify(list)).not.toContain("9111111111");
  });
  it("reveal is allowed for members and leaves an audit entry", async () => {
    const row = await withPlatform((tx) => tx.entry.findFirstOrThrow({ where: { campaignId, emailHash: { not: null } } }));
    expect(await revealEntryContact(c("VIEWER"), row.id)).toEqual({ mobile: "+919111111111", email: "aarav@example.com" });
    const log = await withTenant(c("OWNER"), (tx) => tx.auditLog.findMany({ where: { action: "entry.contact_revealed" } }));
    expect(log).toHaveLength(1);
  });
  it("duplicate mobile: return_existing (default), block, allow", async () => {
    const first = await submit(form("9222222222"));
    const again = await submit(form("+91 92222 22222"));
    expect(again).toMatchObject({ ok: true, duplicate: true, entryId: (first as { entryId: string }).entryId });
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "block" } });
    expect(await submit(form("9222222222"))).toMatchObject({ ok: false, code: "DUPLICATE" });
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow" } });
    const third = await submit(form("9222222222"));
    expect(third).toMatchObject({ ok: true, duplicate: false });
    expect((third as { entryId: string }).entryId).not.toBe((first as { entryId: string }).entryId);
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false } });
  });
  it("the same mobile is not a duplicate across campaigns", async () => {
    const other = await createCampaign(c("EDITOR"), { name: "Other cause", locale: "en", preset: "minimal" });
    await updateCampaign(c("EDITOR"), other.id, { status: "ACTIVE", settings: { captcha: false } });
    const r = await submitEntry({ orgSlug: T.org.slug, campaignSlug: other.slug, raw: form("9222222222"), locale: "en", ip: ip() });
    expect(r).toMatchObject({ ok: true, duplicate: false });
  });
  it("approval mode holds entries as PENDING until a member approves", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, approvalMode: true } });
    const r = await submit(form("9333333333"));
    expect(r).toMatchObject({ ok: true, status: "PENDING" });
    await expect(reviewEntry(c("VIEWER"), (r as { entryId: string }).entryId, "APPROVED")).rejects.toThrow(/Forbidden/);
    expect((await reviewEntry(c("EDITOR"), (r as { entryId: string }).entryId, "APPROVED")).status).toBe("APPROVED");
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false } });
  });
  it("draft/closed campaigns and unknown slugs do not accept entries", async () => {
    expect(await submitEntry({ orgSlug: T.org.slug, campaignSlug: "nope", raw: form("9444444444"), locale: "en" })).toMatchObject({ code: "NOT_FOUND" });
    await updateCampaign(c("EDITOR"), campaignId, { status: "CLOSED" });
    expect(await submit(form("9444444444"))).toMatchObject({ code: "CLOSED" });
    await updateCampaign(c("EDITOR"), campaignId, { status: "ACTIVE" });
  });
  it("returns localised validation errors without storing anything", async () => {
    const before = await withPlatform((tx) => tx.entry.count({ where: { campaignId } }));
    const r = await submit({ name: "", mobile: "123" });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await withPlatform((tx) => tx.entry.count({ where: { campaignId } }))).toBe(before);
  });
  it("rate limits repeated submissions from one IP", async () => {
    const same = "203.0.113.9";
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await submit(form(`96000000${String(i).padStart(2, "0")}`), { ip: same }));
    expect(results.filter((r) => !r.ok && r.code === "RATE").length).toBeGreaterThanOrEqual(2);
  });
  it("captcha failures are rejected when enabled", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: true } });
    setCaptcha({ enabled: true, verify: async (t) => t === "good" });
    expect(await submit(form("9555555555"), { captchaToken: "bad" })).toMatchObject({ code: "CAPTCHA" });
    expect(await submit(form("9555555555"))).toMatchObject({ code: "CAPTCHA" });
    expect(await submit(form("9555555555"), { captchaToken: "good" })).toMatchObject({ ok: true });
    setCaptcha(undefined);
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false } });
  });
  it("OTP-enabled campaigns require a verified mobile", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, otpEnabled: true } });
    expect(await submit(form("9666666666"))).toMatchObject({ code: "OTP" });
    await sendOtp(campaignId, "+919666666666");
    const code = lastOtp()!.code;
    expect(await verifyOtp(campaignId, "+919666666666", "000000")).toBeNull();
    const token = await verifyOtp(campaignId, "+919666666666", code);
    expect(token).toBeTruthy();
    expect(await submit(form("9666666666"), { otpToken: token! })).toMatchObject({ ok: true });
    // a token for one number cannot be used for another
    expect(await submit(form("9677777777"), { otpToken: token! })).toMatchObject({ code: "OTP" });
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false } });
  });
});

describe("assets", () => {
  let png: Buffer;
  const noisy = (w: number, h: number) => {
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24; // deterministic texture
    return raw;
  };
  const mem = new Map<string, Buffer>();
  beforeAll(async () => {
    setStorage({ put: async (k, b) => { mem.set(k, b); }, get: async (k) => mem.get(k) ?? null, delete: async (k) => { mem.delete(k); } });
    png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#3366cc" } }).png().toBuffer();
  });
  it("accepts a real PNG, rejects wrong types, scripts in SVG, and oversize files", async () => {
    const a = await uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "logo.png", mime: "image/png", body: png });
    expect(a.bytes).toBeGreaterThan(0);
    expect(a.bytes).toBeLessThanOrEqual(png.length); // never stored larger than uploaded
    await expect(uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "x.png", mime: "image/png", body: Buffer.from("not an image") })).rejects.toMatchObject({ code: "BAD_FILE" });
    await expect(uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "x.png", mime: "image/png", body: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]) })).rejects.toMatchObject({ code: "BAD_FILE" }); // right header, not an image
    await expect(uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "x.svg", mime: "image/svg+xml", body: Buffer.from("<svg><script>alert(1)</script></svg>") })).rejects.toMatchObject({ code: "BAD_FILE" });
    await expect(uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "big.png", mime: "image/png", body: Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]) })).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
  it("stores backgrounds compressed and capped at 2400px, and keeps transparency on PNGs", async () => {
    const photo = await sharp(noisy(1280, 960), { raw: { width: 1280, height: 960, channels: 3 } }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
    expect(photo.length).toBeLessThan(3 * 1024 * 1024);
    const bg = await uploadAsset(c("EDITOR"), { kind: "BACKGROUND", filename: "photo.jpg", mime: "image/jpeg", body: photo });
    expect(bg.bytes).toBeLessThan(photo.length * 0.6); // re-encoded at a sensible quality
    expect(bg.mime).toBe("image/jpeg");
    const wide = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: "#cc9933" } }).jpeg({ quality: 90 }).toBuffer();
    const big = await uploadAsset(c("EDITOR"), { kind: "BACKGROUND", filename: "wide.jpg", mime: "image/jpeg", body: wide });
    const stored = await sharp((await getStorage().get(big.storageKey))!).metadata();
    expect(Math.max(stored.width!, stored.height!)).toBe(2400);
    const overlay = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 10, g: 20, b: 200, alpha: 0.4 } } }).png().toBuffer();
    const o = await uploadAsset(c("EDITOR"), { kind: "BACKGROUND", filename: "overlay.png", mime: "image/png", body: overlay });
    expect(o.mime).toBe("image/png");
    expect((await sharp((await getStorage().get(o.storageKey))!).metadata()).hasAlpha).toBe(true);
  });
  it("signature uploads need signatory permission; storage quota counts the stored size and is enforced per org", async () => {
    await expect(uploadAsset(c("EDITOR"), { kind: "SIGNATURE", filename: "s.png", mime: "image/png", body: png })).rejects.toThrow(/Forbidden/);
    const key = { orgId_metric_period: { orgId: T.org.id, metric: "storage_bytes", period: "total" } };
    const used = Number((await withPlatform((tx) => tx.usageCounter.findUnique({ where: key })))?.value ?? 0);
    const one = (await uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "probe.png", mime: "image/png", body: png })).bytes;
    expect(Number((await withPlatform((tx) => tx.usageCounter.findUnique({ where: key })))!.value)).toBe(used + one);
    await withPlatform((tx) => tx.organization.update({ where: { id: T.org.id }, data: { limitOverrides: { limits: { storageBytes: used + one + Math.floor(one * 1.5) } } } }));
    await expect(uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "2.png", mime: "image/png", body: png })).resolves.toBeTruthy();
    await expect(uploadAsset(c("EDITOR"), { kind: "LOGO", filename: "3.png", mime: "image/png", body: png })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });
});

void setOtpProvider; void randomUUID;
const listEntriesFor = (ctx: OrgContext) => listEntries(ctx, campaignId, { pageSize: 100 });

describe("concurrent identical submissions", () => {
  const same = { name: "Race Person", mobile: "9333300001", consent: "on" };
  const fire = (n: number) => Promise.all(Array.from({ length: n }, (_, i) => submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: same, locale: "en", ip: `10.77.0.${i + 1}` })));
  const entriesFor = () => withPlatform((tx) => tx.entry.count({ where: { campaignId, name: "Race Person" } }));

  it("block mode lets exactly one of N simultaneous identical submissions in", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "block" } });
    const before = await entriesFor();
    const results = await fire(8);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "DUPLICATE")).toHaveLength(7);
    expect(await entriesFor()).toBe(before + 1);
  });
  it("return_existing mode gives every request the same entry and certificate", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "return_existing" } });
    const raw = { ...same, mobile: "9333300002" };
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw, locale: "en", ip: `10.78.0.${i + 1}` })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.ok && r.entryId)).size).toBe(1);
    expect(new Set(results.map((r) => r.ok && r.certificateId)).size).toBe(1);
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1);
  });
});

describe("addresses that are already taken (real database)", () => {
  it("two organisations with the same name get different addresses, and neither creation fails", async () => {
    const { createOrganization } = await import("@/server/orgs");
    const { makeUser } = await import("./helpers");
    const name = `Same Name ${Math.random().toString(36).slice(2, 8)}`;
    const u1 = await makeUser("dupa"), u2 = await makeUser("dupb");
    const a = await createOrganization(u1.id, name);
    const b = await createOrganization(u2.id, name);
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toMatch(new RegExp(`^${a.slug}-[0-9a-f]{4}$`));
    await cleanup([a.id, b.id], [u1.id, u2.id]);
  });
  it("two campaigns with the same name in one organisation get different addresses", async () => {
    const a = await createCampaign(c("EDITOR"), { name: "Identical Name", locale: "en", preset: "classic" });
    const b = await createCampaign(c("EDITOR"), { name: "Identical Name", locale: "en", preset: "classic" });
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toMatch(new RegExp(`^${a.slug}-[0-9a-f]{4}$`));
  });
});

describe("certificate number prefix from the form", () => {
  it.each([["", "blank (what an untouched form field sends)"], ["   ", "only spaces"], [undefined, "not provided"]])("falls back to initials when it is %j (%s)", async (numberPrefix, _why) => {
    const camp = await createCampaign(c("EDITOR"), { name: "Sant Tukaram Fund", locale: "en", preset: "minimal", numberPrefix });
    expect(camp.numberPrefix).toBe("STF");
  });
  it("uses and normalises an explicit prefix; a name with no Latin letters still gets a usable default", async () => {
    expect((await createCampaign(c("EDITOR"), { name: "Explicit one", locale: "en", preset: "minimal", numberPrefix: " ab-12! " })).numberPrefix).toBe("AB12");
    expect((await createCampaign(c("EDITOR"), { name: "बळीराजाची दिवाळी", locale: "mr", preset: "festive", numberPrefix: "" })).numberPrefix).toBe("CERT");
  });
});
