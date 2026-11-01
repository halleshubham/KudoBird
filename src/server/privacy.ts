import { audit } from "./audit";
import { decrypt, encrypt, newToken } from "./crypto";
import { withPlatform, withTenant } from "./db";
import { OrgError, type OrgContext } from "./orgs";
import { assertCan } from "./permissions";
import { parseSettings } from "./campaigns/schema";
import { getStorage } from "./storage";

/** DPDP Act: a person can ask what we hold about them. Returns everything stored for one entry. Audited. */
export async function exportEntryData(ctx: OrgContext, entryId: string) {
  assertCan(ctx.role, "entries.manage");
  return withTenant(ctx, async (tx) => {
    const e = await tx.entry.findFirst({ where: { id: entryId, orgId: ctx.orgId }, include: { certificate: true, campaign: { select: { name: true } } } });
    if (!e) throw new OrgError("NOT_FOUND", "Entry not found");
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "entry.data_exported", entity: "Entry", entityId: entryId });
    return {
      campaign: e.campaign.name, name: e.name, mobile: decrypt(e.mobileEnc), email: e.emailEnc ? decrypt(e.emailEnc) : null, customFields: e.customData,
      status: e.status, submittedAt: e.createdAt, consentGivenAt: e.consentAt, consentText: e.consentText, publicWallOptIn: e.wallOptIn, language: e.locale,
      certificate: e.certificate ? { number: e.certificate.number, issuedAt: e.certificate.issuedAt, status: e.certificate.status } : null,
    };
  });
}

type Tx = Parameters<Parameters<typeof withPlatform>[0]>[0];

/**
 * Erasure: personal data is removed or irreversibly blanked. The certificate record stays (number and campaign, for the
 * integrity of the numbering) but is revoked as "erased", shows no name, and its images are deleted from storage.
 */
export async function eraseEntryTx(tx: Tx, entryId: string, reason: string): Promise<string[]> {
  const e = await tx.entry.findUnique({ where: { id: entryId }, include: { certificate: true } });
  if (!e) return [];
  await tx.entry.update({
    where: { id: entryId },
    data: { name: "[erased]", mobileEnc: encrypt("erased"), mobileHash: `erased-${newToken(12).token}`, emailEnc: null, emailHash: null, customData: {}, wallOptIn: false, ipHash: null, consentText: null },
  });
  await tx.emailLog.updateMany({ where: { entryId }, data: { toMasked: "•••" } });
  const keys: string[] = [];
  if (e.certificate) {
    for (const o of Object.values(e.certificate.outputs as Record<string, { key: string }>)) keys.push(o.key);
    await tx.certificate.update({
      where: { id: e.certificate.id },
      data: { status: "REVOKED", revokedAt: new Date(), revokeReason: reason, renderData: { name: "[erased]", certificate_no: e.certificate.number }, outputs: {}, renderStatus: "READY" },
    });
  }
  return keys;
}

export async function eraseEntry(ctx: OrgContext, entryId: string) {
  assertCan(ctx.role, "entries.manage");
  const keys = await withTenant(ctx, async (tx) => {
    const e = await tx.entry.findFirst({ where: { id: entryId, orgId: ctx.orgId } });
    if (!e) throw new OrgError("NOT_FOUND", "Entry not found");
    const k = await eraseEntryTx(tx, entryId, "Personal data erased on request");
    await audit(tx, { orgId: ctx.orgId, actorId: ctx.userId, impersonatorId: ctx.impersonatorId, action: "entry.erased", entity: "Entry", entityId: entryId });
    return k;
  });
  await Promise.all(keys.map((k) => getStorage().delete(k).catch(() => {})));
}

/** Retention: erase entries older than each campaign's `retentionDays`. Run daily by the worker. Returns how many were erased. */
export async function purgeExpired(now = new Date(), onlyOrgId?: string): Promise<number> {
  const campaigns = await withPlatform((tx) => tx.campaign.findMany({ where: onlyOrgId ? { orgId: onlyOrgId } : {}, select: { id: true, orgId: true, settings: true } }));
  let erased = 0;
  for (const c of campaigns) {
    const days = parseSettings(c.settings).retentionDays;
    if (!days) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const old = await withPlatform((tx) => tx.entry.findMany({ where: { campaignId: c.id, createdAt: { lt: cutoff }, NOT: { name: "[erased]" } }, select: { id: true }, take: 500 }));
    for (const e of old) {
      const keys = await withPlatform(async (tx) => {
        const k = await eraseEntryTx(tx, e.id, `Retention period of ${days} days elapsed`);
        await audit(tx, { orgId: c.orgId, action: "entry.erased_retention", entity: "Entry", entityId: e.id, meta: { days } });
        return k;
      });
      await Promise.all(keys.map((k) => getStorage().delete(k).catch(() => {})));
      erased++;
    }
  }
  return erased;
}
