import { audit } from "./audit";
import { decrypt } from "./crypto";
import { withTenant } from "./db";
import { OrgError, type OrgContext } from "./orgs";
import { assertCan } from "./permissions";
import { maskEmail, maskMobile } from "./campaigns/countries";
import { parseFields } from "./campaigns/schema";
import { toCsv } from "./csv";

/**
 * Entries as CSV. Contact details are masked unless `full` is requested; full export needs the entries.manage
 * permission and is written to the audit log. Every cell is neutralised against spreadsheet formula injection.
 */
export async function exportEntriesCsv(ctx: OrgContext, campaignId: string, opts: { full?: boolean } = {}): Promise<{ csv: string; filename: string }> {
  assertCan(ctx.role, opts.full ? "entries.manage" : "entries.view");
  return withTenant(ctx, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id: campaignId, orgId: ctx.orgId } });
    if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
    const fields = parseFields(c.formFields);
    const entries = await tx.entry.findMany({ where: { orgId: ctx.orgId, campaignId }, orderBy: { createdAt: "asc" }, include: { certificate: { select: { number: true, status: true } } }, take: 100_000 });
    const logs = await tx.emailLog.findMany({ where: { orgId: ctx.orgId, entryId: { in: entries.map((e) => e.id) }, kind: "CERTIFICATE" }, orderBy: { createdAt: "desc" } });
    const header = ["certificate_no", "name", "status", "certificate_status", "submitted_at", "mobile", "email", "email_delivery", ...fields.map((f) => f.key)];
    const rows = entries.map((e) => {
      const mobile = decrypt(e.mobileEnc);
      const email = e.emailEnc ? decrypt(e.emailEnc) : "";
      const custom = e.customData as Record<string, string>;
      return [e.certificate?.number ?? "", e.name, e.status.toLowerCase(), e.certificate?.status.toLowerCase() ?? "", e.createdAt, opts.full ? mobile : maskMobile(mobile), email ? (opts.full ? email : maskEmail(email)) : "", logs.find((l) => l.entryId === e.id)?.status.toLowerCase() ?? "", ...fields.map((f) => custom[f.key] ?? "")];
    });
    if (opts.full) await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "entries.exported_full", entity: "Campaign", entityId: campaignId, meta: { rows: rows.length } });
    return { csv: toCsv([header, ...rows]), filename: `${c.slug}-entries${opts.full ? "" : "-masked"}.csv` };
  });
}
