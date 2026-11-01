"use server";
import { headers } from "next/headers";
import { t } from "@/i18n/messages";
import { confirmOtpFor, requestOtpFor } from "@/server/campaigns/public";
import { submitEntry } from "@/server/campaigns/service";

export interface PublicState {
  ok?: boolean;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  entryId?: string;
  certificateId?: string;
  error?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
}

async function clientIp() {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

export async function submitPublicAction(_: PublicState | undefined, fd: FormData): Promise<PublicState> {
  const locale = String(fd.get("lang") ?? "en");
  const m = t(locale);
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const res = await submitEntry({
    orgSlug: String(fd.get("org")), campaignSlug: String(fd.get("campaign")), raw, locale,
    ip: await clientIp(), captchaToken: raw["cf-turnstile-response"], otpToken: raw.otpToken,
  });
  if (res.ok) return { ok: true, status: res.status, entryId: res.entryId, certificateId: res.certificateId };
  const base = { values: raw };
  switch (res.code) {
    case "VALIDATION": return { ...base, errors: res.errors };
    case "DUPLICATE": return { ...base, error: m.errDuplicate };
    case "CAPTCHA": return { ...base, error: m.errCaptcha };
    case "RATE": return { ...base, error: m.errRate };
    case "OTP": return { ...base, error: m.errOtp };
    case "CLOSED": case "NOT_FOUND": case "LIMIT": return { ...base, error: m.errClosed };
  }
}

export async function sendOtpAction(org: string, campaign: string, mobile: string, locale: string) {
  const m = t(locale);
  const r = await requestOtpFor(org, campaign, mobile, await clientIp());
  return r === "sent" ? { info: m.otpSent } : { error: r === "invalid" ? m.errMobile : r === "rate" ? m.errRate : m.errGeneric };
}

export async function verifyOtpAction(org: string, campaign: string, mobile: string, code: string, locale: string) {
  const m = t(locale);
  const token = await confirmOtpFor(org, campaign, mobile, code);
  return token ? { token, info: m.otpVerified } : { error: m.errOtp };
}
