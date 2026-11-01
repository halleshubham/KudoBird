import { t } from "@/i18n/messages";
import { getCountry, normalizeMobile } from "./countries";
import type { CampaignSettings, FormField } from "./schema";

export interface ValidEntry {
  name: string;
  mobile: string; // E.164
  email: string | null;
  custom: Record<string, string>;
  consent: boolean;
  wallOptIn: boolean;
}
export type ValidationResult = { ok: true; value: ValidEntry } | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f<>]/;

export const fieldLabel = (f: FormField, locale: string) => (locale === "hi" || locale === "mr" ? f.translations[locale] : undefined) ?? f.label;

/** Validates a raw submission against the campaign's built-in and custom fields, with localised messages. */
export function validateEntry(raw: Record<string, unknown>, fields: FormField[], settings: CampaignSettings, locale: string): ValidationResult {
  const m = t(locale);
  const errors: Record<string, string> = {};
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");

  const name = str("name").replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80 || BAD_CHARS.test(name) || /https?:\/\//i.test(name)) errors.name = m.errName;

  const mobile = normalizeMobile(str("mobile"), settings.mobileCountry);
  if (!mobile) errors.mobile = m.errMobile;

  const emailRaw = str("email").toLowerCase();
  if (emailRaw && (!EMAIL.test(emailRaw) || emailRaw.length > 120)) errors.email = m.errEmail;

  const custom: Record<string, string> = {};
  for (const f of fields) {
    const v = str(f.key);
    if (!v) {
      if (f.required) errors[f.key] = m.errRequired;
      continue;
    }
    if (BAD_CHARS.test(v) && f.type !== "textarea") { errors[f.key] = m.errLength; continue; }
    switch (f.type) {
      case "number": {
        const n = Number(v);
        if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) errors[f.key] = m.errNumber;
        break;
      }
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) errors[f.key] = m.errDate;
        break;
      case "select":
        if (!f.options.includes(v)) errors[f.key] = m.errOption;
        break;
      default: {
        const max = f.max ?? (f.type === "textarea" ? 1000 : 200);
        if (v.length < (f.min ?? 0) || v.length > max || (f.pattern && !new RegExp(f.pattern, "u").test(v))) errors[f.key] = m.errLength;
      }
    }
    custom[f.key] = v;
  }

  const consent = raw.consent === "on" || raw.consent === "true" || raw.consent === true;
  if (settings.consentRequired && !consent) errors.consent = m.errConsent;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, mobile: mobile!, email: emailRaw || null, custom, consent, wallOptIn: raw.wallOptIn === "on" || raw.wallOptIn === "true" } };
}

export const dialCode = (settings: CampaignSettings) => getCountry(settings.mobileCountry).dial;
