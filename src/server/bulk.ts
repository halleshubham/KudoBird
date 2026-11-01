import { actorOf, audit } from "./audit";
import { blindIndex, encrypt, sha256 } from "./crypto";
import { withTenant } from "./db";
import { assertFeature, assertWithinLimit, EntitlementError, getUsage, loadEntitlements } from "./entitlements";
import { issueCertificateTx } from "./certificates/issue";
import { parseCsv, toCsv } from "./csv";
import { OrgError, type OrgContext } from "./orgs";
import { assertCan } from "./permissions";
import { enqueueRenders } from "./queue";
import { entryPayload } from "./webhook-payloads";
import { queueWebhookEventTx } from "./webhooks";
import { parseFields, parseSettings, type FormField } from "./campaigns/schema";
import { validateEntry } from "./campaigns/validation";

export const BULK_MAX_ROWS = 2000;

export type RowStatus = "ok" | "duplicate_in_file" | "duplicate_existing" | "invalid";
export interface PreviewRow { line: number; name: string; mobileMasked: string; email: string | null; status: RowStatus; errors: string[] }
export interface BulkPreview {
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
  willIssue: number;
  /** Remaining certificates this month on the plan (null = unlimited) */
  remaining: number | null;
  overLimit: boolean;
  unknownColumns: string[];
  fileError?: string;
}

interface ParsedRow { line: number; raw: Record<string, string> }

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** CSV template for a campaign: name, mobile, email + its custom field keys. */
export function bulkTemplateCsv(fields: FormField[]): string {
  return toCsv([["name", "mobile", "email", ...fields.map((f) => f.key)], ["Aarav Sharma", "9876543210", "aarav@example.com", ...fields.map(() => "")]]);
}

function parseRows(text: string, fields: FormField[]): { rows: ParsedRow[]; unknown: string[]; fileError?: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], unknown: [], fileError: "The file needs a header row and at least one data row" };
  const header = table[0].map(norm);
  const aliases: Record<string, string> = { full_name: "name", mobile_number: "mobile", phone: "mobile", email_address: "email" };
  const cols = header.map((h) => aliases[h] ?? h);
  if (!cols.includes("name") || !cols.includes("mobile")) return { rows: [], unknown: [], fileError: 'The header must contain "name" and "mobile" columns' };
  const known = new Set(["name", "mobile", "email", ...fields.map((f) => f.key)]);
  const unknown = cols.filter((c) => c && !known.has(c));
  if (table.length - 1 > BULK_MAX_ROWS) return { rows: [], unknown, fileError: `At most ${BULK_MAX_ROWS} rows per upload (this file has ${table.length - 1}). Split it into several files.` };
  const rows = table.slice(1).map((cells, i) => ({ line: i + 2, raw: Object.fromEntries(cols.map((c, j) => [c, (cells[j] ?? "").trim()]).filter(([c]) => c && known.has(c as string))) as Record<string, string> }));
  return { rows, unknown };
}

async function loadCampaign(tx: Parameters<Parameters<typeof withTenant>[1]>[0], ctx: OrgContext, campaignId: string) {
  const c = await tx.campaign.findFirst({ where: { id: campaignId, orgId: ctx.orgId, archivedAt: null } });
  if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
  return { campaign: c, settings: parseSettings(c.settings), fields: parseFields(c.formFields) };
}

/** Validates every row WITHOUT writing anything. The same function backs the commit, so preview and result cannot disagree. */
async function analyse(ctx: OrgContext, campaignId: string, text: string) {
  return withTenant(ctx, async (tx) => {
    await assertFeature(tx, ctx.orgId, "bulkIssue");
    const { campaign, settings, fields } = await loadCampaign(tx, ctx, campaignId);
    const parsed = parseRows(text, fields);
    const empty = { campaign, settings, fields, valid: [] as { line: number; name: string; mobile: string; email: string | null; custom: Record<string, string>; mobileHash: string }[], preview: [] as PreviewRow[] };
    if (parsed.fileError) return { ...empty, parsed };
    // Existing mobiles for duplicate policy, matched by keyed hash (we never decrypt in bulk).
    const existing = new Set((await tx.entry.findMany({ where: { campaignId }, select: { mobileHash: true } })).map((e) => e.mobileHash));
    const seen = new Set<string>();
    for (const row of parsed.rows) {
      // Contributor consent is attested by the uploader for bulk imports, so the consent checkbox is not required per row.
      const v = validateEntry({ ...row.raw, consent: "on" }, fields, { ...settings, consentRequired: false }, campaign.locale);
      if (!v.ok) { empty.preview.push({ line: row.line, name: row.raw.name ?? "", mobileMasked: "", email: row.raw.email || null, status: "invalid", errors: Object.entries(v.errors).map(([k, m]) => `${k}: ${m}`) }); continue; }
      const e = v.value;
      const mobileHash = blindIndex(e.mobile, campaignId);
      const masked = e.mobile.slice(0, 3) + "•".repeat(Math.max(e.mobile.length - 7, 2)) + e.mobile.slice(-4);
      let status: RowStatus = "ok";
      const errors: string[] = [];
      if (settings.duplicateMode !== "allow" && seen.has(mobileHash)) { status = "duplicate_in_file"; errors.push("Same mobile number appears earlier in this file"); }
      else if (settings.duplicateMode !== "allow" && existing.has(mobileHash)) { status = "duplicate_existing"; errors.push("This mobile number already has an entry in this campaign"); }
      seen.add(mobileHash);
      empty.preview.push({ line: row.line, name: e.name, mobileMasked: masked, email: e.email, status, errors });
      if (status === "ok") empty.valid.push({ line: row.line, name: e.name, mobile: e.mobile, email: e.email, custom: e.custom, mobileHash });
    }
    return { ...empty, parsed };
  });
}

export async function previewBulk(ctx: OrgContext, campaignId: string, text: string): Promise<BulkPreview> {
  assertCan(ctx.role, "entries.manage");
  const r = await analyse(ctx, campaignId, text);
  const counts: Record<RowStatus, number> = { ok: 0, duplicate_in_file: 0, duplicate_existing: 0, invalid: 0 };
  for (const p of r.preview) counts[p.status]++;
  const { remaining } = await withTenant(ctx, async (tx) => {
    const { limits } = await loadEntitlements(tx, ctx.orgId);
    const max = limits.certificatesPerMonth;
    return { remaining: max === undefined || max < 0 ? null : Math.max(0, max - (await getUsage(tx, ctx.orgId, "certificatesPerMonth"))) };
  });
  return { rows: r.preview.slice(0, 500), counts, willIssue: counts.ok, remaining, overLimit: remaining !== null && counts.ok > remaining, unknownColumns: r.parsed.unknown, fileError: r.parsed.fileError };
}

export interface BulkResult { issued: number; failed: number; skipped: number; issuedCertificateIds: string[] }

/**
 * Issues certificates for every valid row. Re-validates server-side (the preview is advisory). All-or-nothing on the plan
 * limit; individual row failures do not abort the rest. `sendEmails` controls whether contributors are mailed their certificate.
 */
export async function commitBulk(ctx: OrgContext, campaignId: string, text: string, opts: { attested: boolean; sendEmails: boolean }): Promise<BulkResult> {
  assertCan(ctx.role, "entries.manage");
  if (!opts.attested) throw new OrgError("ATTESTATION_REQUIRED", "Confirm that you have each person's consent before issuing");
  const r = await analyse(ctx, campaignId, text);
  if (r.parsed.fileError) throw new OrgError("BAD_FILE", r.parsed.fileError);
  await withTenant(ctx, (tx) => assertWithinLimit(tx, ctx.orgId, "certificatesPerMonth", r.valid.length)); // whole batch must fit the plan
  const issuedIds: string[] = [];
  let failed = 0;
  const locale = r.campaign.locale;
  const consentText = "Bulk import: consent attested by the organisation";
  for (let i = 0; i < r.valid.length; i += 50) {
    for (const row of r.valid.slice(i, i + 50)) {
      try {
        const id = await withTenant(ctx, async (tx) => {
          const entry = await tx.entry.create({
            data: {
              orgId: ctx.orgId, campaignId, name: row.name, mobileEnc: encrypt(row.mobile), mobileHash: row.mobileHash,
              emailEnc: row.email ? encrypt(row.email) : null, emailHash: row.email ? blindIndex(row.email, ctx.orgId) : null,
              customData: row.custom, status: "APPROVED", consentAt: new Date(), consentText, locale, ipHash: sha256(`bulk:${ctx.userId}`),
              reviewedById: ctx.userId, reviewedAt: new Date(),
            },
          });
          await queueWebhookEventTx(tx, ctx.orgId, "entry.created", async (pii) => entryPayload(entry, r.campaign.name, pii));
          const cert = await issueCertificateTx(tx, entry.id);
          if (row.email && !opts.sendEmails) {
            // Recorded as SKIPPED so the automatic post-render email does not fire; a manual "Resend email" still works.
            await tx.emailLog.create({ data: { orgId: ctx.orgId, entryId: entry.id, certificateId: cert.id, kind: "CERTIFICATE", toMasked: "•••", status: "SKIPPED", error: "Bulk import: email not requested" } });
          }
          return cert.id;
        });
        issuedIds.push(id);
      } catch (e) {
        if (e instanceof EntitlementError) { failed++; break; }
        failed++;
        console.error("[bulk] row failed", row.line, e instanceof Error ? e.message : e);
      }
    }
  }
  await withTenant(ctx, (tx) => audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "bulk.issued", entity: "Campaign", entityId: campaignId, meta: { issued: issuedIds.length, failed, skipped: r.preview.length - r.valid.length, emails: opts.sendEmails } }));
  await enqueueRenders(issuedIds);
  return { issued: issuedIds.length, failed, skipped: r.preview.length - r.valid.length, issuedCertificateIds: issuedIds };
}
