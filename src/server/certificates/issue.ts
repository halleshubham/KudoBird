import { randomBytes } from "node:crypto";
import { actorOf, audit } from "../audit";
import { withPlatform, withTenant, type Tx } from "../db";
import { assertWithinLimit, recordUsage } from "../entitlements";
import { OrgError, type OrgContext } from "../orgs";
import { assertCan } from "../permissions";
import { parseFields } from "../campaigns/schema";
import { enqueueRender } from "../queue";
import { formatCertDate } from "../../lib/format";
import { revealContact } from "../pii";
import { certificatePayload } from "../webhook-payloads";
import { queueWebhookEventTx } from "../webhooks";

export const newPublicId = () => randomBytes(16).toString("base64url"); // 128 bits, not guessable

export { formatCertDate };

/**
 * Issues the certificate for an approved entry. Idempotent per entry. Runs inside the caller's
 * transaction so the number, the usage metering and the certificate row commit together.
 * Only name, number, date and fields flagged "show on certificate" are copied: never mobile or email.
 */
export async function issueCertificateTx(tx: Tx, entryId: string): Promise<{ id: string; publicId: string; created: boolean }> {
  const existing = await tx.certificate.findUnique({ where: { entryId } });
  if (existing) return { id: existing.id, publicId: existing.publicId, created: false };
  const entry = await tx.entry.findUniqueOrThrow({ where: { id: entryId }, include: { campaign: { include: { org: true } } } });
  if (entry.status !== "APPROVED") throw new OrgError("NOT_APPROVED", "Only approved entries get a certificate");
  const { campaign } = entry;
  if (!campaign.templateId) throw new OrgError("NO_TEMPLATE", "Campaign has no certificate design");
  await assertWithinLimit(tx, entry.orgId, "certificatesPerMonth");

  const tpl = await tx.template.findUniqueOrThrow({ where: { id: campaign.templateId } });
  const version = await tx.templateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: tpl.id, version: tpl.latestVersion } } });
  // Atomic counter: concurrent submissions can never receive the same number.
  const { numberSeq: seq } = await tx.campaign.update({ where: { id: campaign.id }, data: { numberSeq: { increment: 1 } }, select: { numberSeq: true } });
  const now = new Date();
  const number = `${campaign.numberPrefix}-${now.getFullYear()}-${String(seq).padStart(5, "0")}`;

  const custom = entry.customData as Record<string, string>;
  const shown = Object.fromEntries(parseFields(campaign.formFields).filter((f) => f.showOnCertificate && custom[f.key]).map((f) => [f.key, custom[f.key]]));
  const cert = await tx.certificate.create({
    data: {
      publicId: newPublicId(), orgId: entry.orgId, campaignId: campaign.id, entryId, seq, number, templateVersionId: version.id, locale: entry.locale,
      renderData: { ...shown, name: entry.name, campaign: campaign.name, org: campaign.org.name, date: formatCertDate(now, entry.locale), certificate_no: number },
    },
  });
  await recordUsage(tx, entry.orgId, "certificates_issued", 1);
  await audit(tx, { orgId: entry.orgId, action: "certificate.issued", entity: "Certificate", entityId: cert.id, meta: { number } });
  await queueWebhookEventTx(tx, entry.orgId, "certificate.issued", async (pii) => certificatePayload(cert, campaign.name, pii ? revealContact(entry) : undefined));
  return { id: cert.id, publicId: cert.publicId, created: true };
}

/** Issue + queue render (platform context: public submissions and approval flows). */
export async function issueCertificate(entryId: string): Promise<{ id: string; publicId: string }> {
  const r = await withPlatform((tx) => issueCertificateTx(tx, entryId));
  if (r.created) await enqueueRender(r.id);
  return r;
}

// ---------------------------------------------------------------- org-side actions


/** Re-renders with the campaign's CURRENT template version (explicit action; issued certificates are otherwise frozen). */
export async function regenerateCertificate(ctx: OrgContext, certificateId: string, useLatestDesign = false) {
  assertCan(ctx.role, "entries.manage");
  await withTenant(ctx, async (tx) => {
    const cert = await tx.certificate.findFirst({ where: { id: certificateId, orgId: ctx.orgId }, include: { campaign: true } });
    if (!cert) throw new OrgError("NOT_FOUND", "Certificate not found");
    let templateVersionId = cert.templateVersionId;
    if (useLatestDesign && cert.campaign.templateId) {
      const tpl = await tx.template.findUniqueOrThrow({ where: { id: cert.campaign.templateId } });
      templateVersionId = (await tx.templateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: tpl.id, version: tpl.latestVersion } } })).id;
    }
    await tx.certificate.update({ where: { id: cert.id }, data: { renderStatus: "QUEUED", renderError: null, templateVersionId } });
    await audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "certificate.regenerated", entity: "Certificate", entityId: cert.id, meta: { useLatestDesign } });
  });
  await enqueueRender(certificateId, true);
}

export async function revokeCertificate(ctx: OrgContext, certificateId: string, reason?: string) {
  assertCan(ctx.role, "entries.manage");
  await withTenant(ctx, async (tx) => {
    const cert = await tx.certificate.findFirst({ where: { id: certificateId, orgId: ctx.orgId } });
    if (!cert) throw new OrgError("NOT_FOUND", "Certificate not found");
    const revoked = await tx.certificate.update({ where: { id: cert.id }, data: { status: "REVOKED", revokedAt: new Date(), revokeReason: reason?.slice(0, 300) ?? null, renderStatus: "QUEUED" }, include: { campaign: { select: { name: true } }, entry: true } });
    await queueWebhookEventTx(tx, ctx.orgId, "certificate.revoked", async (pii) => certificatePayload(revoked, revoked.campaign.name, pii ? revealContact(revoked.entry) : undefined));
    await audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "certificate.revoked", entity: "Certificate", entityId: cert.id, meta: { reason } });
  });
  await enqueueRender(certificateId, true); // re-render so images carry the REVOKED stamp
}

export async function restoreCertificate(ctx: OrgContext, certificateId: string) {
  assertCan(ctx.role, "entries.manage");
  await withTenant(ctx, async (tx) => {
    const cert = await tx.certificate.findFirst({ where: { id: certificateId, orgId: ctx.orgId } });
    if (!cert) throw new OrgError("NOT_FOUND", "Certificate not found");
    await tx.certificate.update({ where: { id: cert.id }, data: { status: "ACTIVE", revokedAt: null, revokeReason: null, renderStatus: "QUEUED" } });
    await audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "certificate.restored", entity: "Certificate", entityId: cert.id });
  });
  await enqueueRender(certificateId, true);
}
