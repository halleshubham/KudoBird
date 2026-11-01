import { withTenant } from "../db";
import { OrgError, type OrgContext } from "../orgs";
import { assertCan } from "../permissions";
import { actorOf, audit } from "../audit";
import { enqueueEmail } from "../queue";

/** Manually re-sends the certificate email (still skips suppressed addresses and respects plan limits). */
export async function resendCertificateEmail(ctx: OrgContext, certificateId: string) {
  assertCan(ctx.role, "entries.manage");
  await withTenant(ctx, async (tx) => {
    const cert = await tx.certificate.findFirst({ where: { id: certificateId, orgId: ctx.orgId }, include: { entry: { select: { emailEnc: true } } } });
    if (!cert) throw new OrgError("NOT_FOUND", "Certificate not found");
    if (!cert.entry.emailEnc) throw new OrgError("NO_EMAIL", "This contributor did not give an email address");
    if (cert.renderStatus !== "READY") throw new OrgError("NOT_READY", "The certificate is still being prepared");
    await audit(tx, { orgId: ctx.orgId, ...actorOf(ctx), action: "certificate.email_resent", entity: "Certificate", entityId: cert.id });
  });
  await enqueueEmail({ kind: "certificate", id: certificateId, force: true });
}
