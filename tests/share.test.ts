import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queue", () => ({ enqueueRender: vi.fn(async () => {}), enqueueEmail: vi.fn(async () => {}), RENDER_QUEUE: "render", EMAIL_QUEUE: "email" }));

import { prisma, withPlatform } from "@/server/db";
import { createCampaign, reviewEntry, submitEntry, updateCampaign } from "@/server/campaigns/service";
import { getCampaignStats, getWall, recordCertificateEvent } from "@/server/certificates/events";
import { revokeCertificate } from "@/server/certificates/issue";
import { generateMetadata } from "@/app/c/[publicId]/page";
import type { OrgContext } from "@/server/orgs";
import { cleanup, makeOrg } from "./helpers";

let T: Awaited<ReturnType<typeof makeOrg>>;
let O: Awaited<ReturnType<typeof makeOrg>>;
let slug = ""; let campaignId = ""; let publicId = ""; let certId = "";
const c = (r: "OWNER" | "EDITOR" | "VIEWER") => T.ctx(r) as OrgContext;
const BROWSER = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36";
let ipN = 0;
const ip = () => `192.0.2.${++ipN}`;
let m = 0;
const mobile = () => `96${String(30000000 + ++m * 13).slice(0, 8)}`;

beforeAll(async () => {
  T = await makeOrg(["EDITOR", "VIEWER"]);
  O = await makeOrg();
  const camp = await createCampaign(c("EDITOR"), { name: "बळीराजाची दिवाळी", locale: "mr", preset: "festive" });
  campaignId = camp.id; slug = camp.slug;
  await updateCampaign(c("EDITOR"), campaignId, { status: "ACTIVE", settings: { captcha: false, duplicateMode: "allow", wallEnabled: true, hashtags: ["बळीराजा", "KudoBird"], shareText: "मी {{campaign}} मध्ये योगदान दिले! {{url}}" } });
  const r = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name: "सुनील पाटील", mobile: mobile(), email: "private@example.com", consent: "on", wallOptIn: "on" }, locale: "mr", ip: ip() });
  const cert = await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { entryId: (r as { entryId: string }).entryId } }));
  publicId = cert.publicId; certId = cert.id;
  await withPlatform((tx) => tx.certificate.update({ where: { id: cert.id }, data: { renderStatus: "READY", outputs: { square: { key: "s", hash: "sq1", mime: "image/png" }, link: { key: "l", hash: "lk1", mime: "image/png" } } } }));
});
afterAll(async () => {
  await cleanup([T.org.id, O.org.id], [...T.members, ...O.members].map((x) => x.userId));
  await prisma.$disconnect();
});

describe("share page meta tags (WhatsApp, Facebook, X, LinkedIn, Telegram previews)", () => {
  it("emits Open Graph and Twitter Card tags pointing at the 1200×630 image", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ publicId }) });
    expect(meta.title).toBe("सुनील पाटील · बळीराजाची दिवाळी");
    expect(meta.openGraph).toMatchObject({ type: "website", title: "सुनील पाटील · बळीराजाची दिवाळी", url: expect.stringContaining(`/c/${publicId}`) });
    const img = (meta.openGraph!.images as { url: string; width: number; height: number }[])[0];
    expect(img).toMatchObject({ width: 1200, height: 630 });
    expect(img.url).toMatch(new RegExp(`^https?://[^/]+/c/${publicId}/img/link\\?v=lk1$`)); // absolute URL, cache-busting hash
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [img.url] });
    expect(meta.robots).toMatchObject({ index: false });
  });
  it("falls back to a plain summary card until the link image exists, and 404-style for unknown ids", async () => {
    await withPlatform((tx) => tx.certificate.update({ where: { id: certId }, data: { outputs: {} } }));
    const meta = await generateMetadata({ params: Promise.resolve({ publicId }) });
    expect(meta.openGraph!.images).toBeUndefined();
    expect(meta.twitter).toMatchObject({ card: "summary" });
    await withPlatform((tx) => tx.certificate.update({ where: { id: certId }, data: { outputs: { square: { key: "s", hash: "sq1", mime: "image/png" }, link: { key: "l", hash: "lk1", mime: "image/png" } } } }));
    expect((await generateMetadata({ params: Promise.resolve({ publicId: "A".repeat(22) }) })).title).toBe("Certificate not found");
  });
  it("never leaks mobile or email into the metadata", async () => {
    const meta = JSON.stringify(await generateMetadata({ params: Promise.resolve({ publicId }) }));
    expect(meta).not.toContain("private@example.com");
    expect(meta).not.toMatch(/\d{10}/);
  });
});

describe("tracking views and shares per platform", () => {
  it("records page views by source and share clicks by platform", async () => {
    for (const platform of ["whatsapp", "whatsapp", "facebook", "x", "linkedin", "telegram", "copy", "native", "instagram"]) {
      expect(await recordCertificateEvent(publicId, { type: "SHARE", platform }, { ip: ip(), userAgent: BROWSER })).toBe("recorded");
    }
    for (const platform of ["whatsapp", "whatsapp", "email", "qr"]) {
      expect(await recordCertificateEvent(publicId, { type: "VIEW", platform }, { ip: ip(), userAgent: BROWSER })).toBe("recorded");
    }
    const s = await getCampaignStats(c("VIEWER"), campaignId);
    expect(s.shares).toBe(9);
    expect(s.sharesByPlatform).toMatchObject({ whatsapp: 2, facebook: 1, x: 1, linkedin: 1, telegram: 1, copy: 1, native: 1, instagram: 1 });
    expect(s.views).toBe(4);
    expect(s.viewsBySource).toMatchObject({ whatsapp: 2, email: 1, qr: 1 });
    expect(s.certificates).toBe(1);
  });
  it("ignores bots and link-preview fetchers for views; rejects junk platforms; unknown ids 404", async () => {
    for (const ua of ["facebookexternalhit/1.1", "WhatsApp/2.23", "Twitterbot/1.0", "TelegramBot (like TwitterBot)", "Googlebot/2.1", "", undefined]) {
      expect(await recordCertificateEvent(publicId, { type: "VIEW" }, { ip: ip(), userAgent: ua })).toBe("ignored");
    }
    expect(await recordCertificateEvent(publicId, { type: "SHARE", platform: "myspace" }, { ip: ip(), userAgent: BROWSER })).toBe("invalid");
    expect(await recordCertificateEvent(publicId, { type: "DELETE" }, { ip: ip(), userAgent: BROWSER })).toBe("invalid");
    expect(await recordCertificateEvent("A".repeat(22), { type: "VIEW" }, { ip: ip(), userAgent: BROWSER })).toBe("not_found");
    expect((await getCampaignStats(c("VIEWER"), campaignId)).views).toBe(4);
  });
  it("rate limits event spam from one address", async () => {
    const same = "198.18.0.1";
    const out = [];
    for (let i = 0; i < 130; i++) out.push(await recordCertificateEvent(publicId, { type: "SHARE", platform: "copy" }, { ip: same, userAgent: BROWSER }));
    expect(out.filter((x) => x === "rate_limited").length).toBeGreaterThan(0);
  });
  it("stats are tenant-scoped and need stats permission", async () => {
    await expect(getCampaignStats(O.ctx("OWNER") as OrgContext, campaignId)).rejects.toThrow(/not found/i);
  });
});

describe("wall of contributors", () => {
  it("lists only opted-in contributors with valid certificates, names only", async () => {
    const mk = (name: string, wall: boolean) => submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name, mobile: mobile(), email: "x@example.com", consent: "on", ...(wall ? { wallOptIn: "on" } : {}) }, locale: "mr", ip: ip() });
    await mk("Not Opted In", false);
    const gone = await mk("Revoked Person", true);
    const goneCert = await withPlatform((tx) => tx.certificate.findUniqueOrThrow({ where: { entryId: (gone as { entryId: string }).entryId } }));
    await revokeCertificate(c("EDITOR"), goneCert.id);
    const w = await getWall(T.org.slug, slug);
    expect(w?.enabled).toBe(true);
    expect(w?.names).toEqual(["सुनील पाटील"]);
    expect(JSON.stringify(w?.names)).not.toContain("example.com");
  });
  it("is empty when the campaign has not enabled the wall, and the opt-in is dropped at submit time", async () => {
    await updateCampaign(c("EDITOR"), campaignId, { settings: { captcha: false, duplicateMode: "allow", wallEnabled: false } });
    expect((await getWall(T.org.slug, slug))?.enabled).toBe(false);
    const r = await submitEntry({ orgSlug: T.org.slug, campaignSlug: slug, raw: { name: "Late Opt In", mobile: mobile(), consent: "on", wallOptIn: "on" }, locale: "en", ip: ip() });
    expect((await withPlatform((tx) => tx.entry.findUniqueOrThrow({ where: { id: (r as { entryId: string }).entryId } }))).wallOptIn).toBe(false);
    expect(await getWall(T.org.slug, "does-not-exist")).toBeNull();
  });
});

import { platformHref, shareText, shareTextWithoutUrl, shareUrl } from "@/lib/share-links";

describe("share links", () => {
  const i = { origin: "https://certs.example.org", publicId: "abc123", template: "मी बळीराजाची दिवाळी मध्ये योगदान दिले! {{url}}", hashtags: ["बळीराजा", "KudoBird"] };
  it("every platform gets its own tracked url so views can be attributed", () => {
    expect(shareUrl(i, "whatsapp")).toBe("https://certs.example.org/c/abc123?s=whatsapp");
    expect(shareUrl(i, "telegram")).toBe("https://certs.example.org/c/abc123?s=telegram");
  });
  it("WhatsApp: text + tracked link + hashtags in a wa.me URL", () => {
    const u = new URL(platformHref(i, "whatsapp"));
    expect(u.origin + u.pathname).toBe("https://wa.me/");
    expect(u.searchParams.get("text")).toBe("मी बळीराजाची दिवाळी मध्ये योगदान दिले! https://certs.example.org/c/abc123?s=whatsapp #बळीराजा #KudoBird");
  });
  it("Facebook, LinkedIn: only the page url (the preview comes from Open Graph tags)", () => {
    expect(new URL(platformHref(i, "facebook")).searchParams.get("u")).toBe("https://certs.example.org/c/abc123?s=facebook");
    expect(new URL(platformHref(i, "linkedin")).searchParams.get("url")).toBe("https://certs.example.org/c/abc123?s=linkedin");
  });
  it("X and Telegram: url passed separately, text has no duplicate link", () => {
    const x = new URL(platformHref(i, "x"));
    expect(x.searchParams.get("url")).toBe("https://certs.example.org/c/abc123?s=x");
    expect(x.searchParams.get("text")).toBe("मी बळीराजाची दिवाळी मध्ये योगदान दिले! #बळीराजा #KudoBird");
    const t = new URL(platformHref(i, "telegram"));
    expect(t.searchParams.get("url")).toBe("https://certs.example.org/c/abc123?s=telegram");
    expect(t.searchParams.get("text")).not.toContain("http");
  });
  it("appends the link when the template has no {{url}}, and works without hashtags", () => {
    const j = { ...i, template: "Proud contributor", hashtags: [] };
    expect(shareText(j, "copy")).toBe("Proud contributor https://certs.example.org/c/abc123?s=copy");
    expect(shareTextWithoutUrl(j)).toBe("Proud contributor");
  });
  it("urls are encoded so names/hashtags cannot break out of the query string", () => {
    const evil = { ...i, template: "a&b=c#d {{url}}" };
    const u = new URL(platformHref(evil, "whatsapp"));
    expect([...u.searchParams.keys()]).toEqual(["text"]);
  });
});
