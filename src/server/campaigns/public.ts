import { withPlatform } from "../db";
import { rateLimit } from "../security/ratelimit";
import { sha256 } from "../crypto";
import { sendOtp, verifyOtp } from "../security/otp";
import { normalizeMobile } from "./countries";
import { parseFields, parseSettings } from "./schema";

/** Resolves a public campaign by org + campaign slug. No account needed; returns only public-safe data. */
export async function getPublicCampaign(orgSlug: string, campaignSlug: string) {
  const c = await withPlatform((tx) =>
    tx.campaign.findFirst({
      where: { slug: campaignSlug, archivedAt: null, org: { slug: orgSlug, status: "ACTIVE", deletedAt: null } },
      include: { org: { select: { name: true, slug: true, primaryColor: true } } },
    }),
  );
  if (!c || c.status === "DRAFT") return null;
  return {
    id: c.id, name: c.name, description: c.description, status: c.status, locale: c.locale,
    org: c.org, settings: parseSettings(c.settings), fields: parseFields(c.formFields),
  };
}

export async function requestOtpFor(orgSlug: string, campaignSlug: string, rawMobile: string, ip: string): Promise<"sent" | "invalid" | "rate" | "unavailable"> {
  const c = await getPublicCampaign(orgSlug, campaignSlug);
  if (!c || c.status !== "ACTIVE" || !c.settings.otpEnabled) return "unavailable";
  const mobile = normalizeMobile(rawMobile, c.settings.mobileCountry);
  if (!mobile) return "invalid";
  const [a, b] = await Promise.all([rateLimit(`otp:${c.id}:${sha256(mobile)}`, 3, 600), rateLimit(`otp-ip:${c.id}:${sha256(ip)}`, 10, 600)]);
  if (!a.allowed || !b.allowed) return "rate";
  await sendOtp(c.id, mobile);
  return "sent";
}

export async function confirmOtpFor(orgSlug: string, campaignSlug: string, rawMobile: string, code: string): Promise<string | null> {
  const c = await getPublicCampaign(orgSlug, campaignSlug);
  if (!c) return null;
  const mobile = normalizeMobile(rawMobile, c.settings.mobileCountry);
  return mobile ? verifyOtp(c.id, mobile, code.trim()) : null;
}
