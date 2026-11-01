import { z } from "zod";

export const LOCALES = ["mr", "hi", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const RESERVED_KEYS = ["name", "mobile", "email", "campaign", "org", "date", "certificate_no"];

export const fieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, "Key must be lowercase letters, digits or _").refine((k) => !RESERVED_KEYS.includes(k), "This key is reserved"),
  label: z.string().trim().min(1).max(80),
  translations: z.object({ hi: z.string().max(80).optional(), mr: z.string().max(80).optional() }).default({}),
  type: z.enum(["text", "number", "date", "select", "textarea"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  /** text/textarea length or number range */
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().max(200).optional(),
  showOnCertificate: z.boolean().default(false),
});
export type FormField = z.infer<typeof fieldSchema>;
export const fieldsSchema = z.array(fieldSchema).max(15).superRefine((fields, ctx) => {
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (seen.has(f.key)) ctx.addIssue({ code: "custom", message: `Duplicate key "${f.key}"`, path: [i, "key"] });
    seen.add(f.key);
    if (f.type === "select" && f.options.length === 0) ctx.addIssue({ code: "custom", message: "Select fields need options", path: [i, "options"] });
    if (f.pattern) {
      try { new RegExp(f.pattern); } catch { ctx.addIssue({ code: "custom", message: "Invalid pattern", path: [i, "pattern"] }); }
    }
  });
});

const i18nText = (max: number) => z.object({ en: z.string().max(max).optional(), hi: z.string().max(max).optional(), mr: z.string().max(max).optional() }).default({});

/** Per-campaign overrides for contributor emails; empty falls back to the built-in translations. Supports {{name}}, {{campaign}}, {{certificate_no}}, {{org}}. */
export const emailTextsSchema = z.object({
  certificateSubject: i18nText(150),
  certificateIntro: i18nText(800),
  rejectedSubject: i18nText(150),
  rejectedIntro: i18nText(800),
}).default({});

/** An allowed embedding site: scheme + host (+ port) only. http is accepted for localhost, for development. */
export function normalizeOrigin(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error(`"${raw.trim()}" is not a valid website address`); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && local))) throw new Error(`"${raw.trim()}" must start with https://`);
  if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) throw new Error(`Use only the site address, without a path: ${u.origin}`);
  if (u.hostname.includes("*")) throw new Error("Wildcards are not allowed");
  return u.origin;
}
const originSchema = z.string().transform((v, ctx) => { try { return normalizeOrigin(v); } catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); return z.NEVER; } });

export const settingsSchema = z.object({
  email: emailTextsSchema,
  /** Websites allowed to show this campaign's form in an iframe. Empty = embedding is off. */
  embedOrigins: z.array(originSchema).max(10).default([]),
  languages: z.array(z.enum(LOCALES)).min(1).default(["mr", "hi", "en"]),
  mobileCountry: z.string().length(2).default("IN"),
  duplicateMode: z.enum(["block", "allow", "return_existing"]).default("return_existing"),
  approvalMode: z.boolean().default(false),
  captcha: z.boolean().default(true),
  otpEnabled: z.boolean().default(false),
  consentRequired: z.boolean().default(true),
  /** Optional per-language override of the consent sentence; empty -> built-in translation. */
  consentText: z.object({ en: z.string().max(600).optional(), hi: z.string().max(600).optional(), mr: z.string().max(600).optional() }).default({}),
  purposeText: z.object({ en: z.string().max(400).optional(), hi: z.string().max(400).optional(), mr: z.string().max(400).optional() }).default({}),
  wallEnabled: z.boolean().default(false),
  shareText: z.string().max(280).default("I received a certificate for {{campaign}}! {{url}}"),
  hashtags: z.array(z.string().regex(/^[\p{L}\p{M}\p{N}_]{1,40}$/u)).max(10).default([]),
  /** Retention in days for entries (null = keep until deleted). Enforced by the retention job. */
  retentionDays: z.number().int().min(30).max(3650).nullable().default(null),
});
export type CampaignSettings = z.infer<typeof settingsSchema>;

export const parseSettings = (raw: unknown): CampaignSettings => settingsSchema.parse(raw ?? {});
export const parseFields = (raw: unknown): FormField[] => fieldsSchema.parse(raw ?? []);
