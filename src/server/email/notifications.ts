import * as React from "react";
import { appUrl } from "../urls";
import { emailCopy } from "@/i18n/email";
import { parseSettings, type Locale } from "../campaigns/schema";
import { blindIndex } from "../crypto";
import { revealEmail } from "../pii";
import { withPlatform } from "../db";
import { assertFeature, assertWithinLimit, EntitlementError, recordUsage } from "../entitlements";

import { maskEmail } from "../campaigns/countries";
import { replacePlaceholders } from "../render/placeholders";
import { getStorage } from "../storage";
import { sendEmail } from "./index";
import { AdminEntriesEmail, ContributorEmail } from "./templates";
import type { EmailKind, EmailStatus } from "@prisma/client";

export const suppressionHash = (email: string) => blindIndex(email.toLowerCase(), "suppress");

export async function isSuppressed(email: string): Promise<boolean> {
  return !!(await withPlatform((tx) => tx.suppression.findUnique({ where: { emailHash: suppressionHash(email) } })));
}

/** Platform sender by default; an org's own verified domain when its plan allows (customEmailSender). */
export async function resolveSender(orgId: string): Promise<{ from?: string }> {
  return withPlatform(async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (!org.emailFrom || !org.emailDomainVerified) return {};
    try { await assertFeature(tx, orgId, "customEmailSender"); } catch (e) { if (e instanceof EntitlementError) return {}; throw e; }
    return { from: `${org.name.replace(/[<>"]/g, "")} <${org.emailFrom}>` };
  });
}

interface Delivery {
  orgId: string; kind: EmailKind; to: string; subject: string; react: React.ReactElement;
  entryId?: string; certificateId?: string; attachments?: { filename: string; content: Buffer }[];
  /** Contributor mail is metered and suppression-checked. Internal mail to org members is not. */
  contributor: boolean;
}

/** Single delivery path: suppression -> plan limit -> send -> log. Returns the final status. */
export async function deliver(d: Delivery): Promise<EmailStatus> {
  const log = (status: EmailStatus, extra: { providerId?: string; error?: string } = {}) =>
    withPlatform((tx) => tx.emailLog.create({ data: { orgId: d.orgId, entryId: d.entryId, certificateId: d.certificateId, kind: d.kind, toMasked: maskEmail(d.to), status, ...extra } }));
  if (d.contributor) {
    if (await isSuppressed(d.to)) { await log("SUPPRESSED", { error: "Address previously bounced or complained" }); return "SUPPRESSED"; }
    try { await withPlatform((tx) => assertWithinLimit(tx, d.orgId, "emailsPerMonth")); }
    catch (e) { if (e instanceof EntitlementError) { await log("SKIPPED", { error: "Monthly email limit reached" }); return "SKIPPED"; } throw e; }
  }
  const sender = d.contributor ? await resolveSender(d.orgId) : {};
  try {
    const { id } = await sendEmail({ to: d.to, subject: d.subject, react: d.react, attachments: d.attachments, from: sender.from, tags: { kind: d.kind.toLowerCase() } });
    await log("SENT", { providerId: id });
    if (d.contributor) await withPlatform((tx) => recordUsage(tx, d.orgId, "emails_sent", 1));
    return "SENT";
  } catch (e) {
    await log("FAILED", { error: (e instanceof Error ? e.message : "send failed").slice(0, 300) });
    throw e; // let the queue retry
  }
}

const fill = (text: string, data: Record<string, string>) => replacePlaceholders(text, data);

/** Certificate delivery (PNG attached + link). Idempotent unless `force` (manual resend). */
export async function sendCertificateEmail(certificateId: string, force = false): Promise<EmailStatus | "NO_EMAIL" | "ALREADY_SENT" | "REVOKED"> {
  const cert = await withPlatform((tx) => tx.certificate.findUnique({ where: { id: certificateId }, include: { entry: true, campaign: { include: { org: true } } } }));
  if (!cert || !cert.entry.emailEnc) return "NO_EMAIL";
  if (cert.status === "REVOKED") return "REVOKED";
  if (!force) {
    const prior = await withPlatform((tx) => tx.emailLog.findFirst({ where: { certificateId, kind: "CERTIFICATE", status: { in: ["SENT", "DELIVERED", "DELAYED", "SUPPRESSED", "SKIPPED"] } } }));
    if (prior) return "ALREADY_SENT";
  }
  const to = revealEmail(cert.entry)!; // checked non-null above
  const locale = cert.entry.locale;
  const settings = parseSettings(cert.campaign.settings);
  const copy = emailCopy(locale);
  const data = { ...(cert.renderData as Record<string, string>) };
  const subject = fill(settings.email.certificateSubject[locale as Locale] || copy.certSubject, data);
  const intro = fill(settings.email.certificateIntro[locale as Locale] || copy.certIntro, data);
  const square = (cert.outputs as Record<string, { key: string }>).square;
  const png = square ? await getStorage().get(square.key) : null;
  return deliver({
    orgId: cert.orgId, entryId: cert.entryId, certificateId, kind: "CERTIFICATE", to, subject, contributor: true,
    attachments: png ? [{ filename: `${cert.number}.png`, content: png }] : undefined,
    react: React.createElement(ContributorEmail, {
      locale, hello: fill(copy.hello, data), intro, note: png ? copy.certAttached : undefined, buttonLabel: copy.certButton,
      url: appUrl(`/c/${cert.publicId}?s=email`), footer: fill(copy.footer, data), accent: cert.campaign.org.primaryColor ?? undefined,
    }),
  });
}

export async function sendRejectionEmail(entryId: string): Promise<EmailStatus | "NO_EMAIL"> {
  const entry = await withPlatform((tx) => tx.entry.findUnique({ where: { id: entryId }, include: { campaign: { include: { org: true } } } }));
  if (!entry?.emailEnc || entry.status !== "REJECTED") return "NO_EMAIL";
  const locale = entry.locale;
  const copy = emailCopy(locale);
  const settings = parseSettings(entry.campaign.settings);
  const data = { name: entry.name, campaign: entry.campaign.name, org: entry.campaign.org.name };
  return deliver({
    orgId: entry.orgId, entryId, kind: "REJECTED", to: revealEmail(entry)!, contributor: true,
    subject: fill(settings.email.rejectedSubject[locale as Locale] || copy.rejectedSubject, data),
    react: React.createElement(ContributorEmail, { locale, hello: fill(copy.hello, data), intro: fill(settings.email.rejectedIntro[locale as Locale] || copy.rejectedIntro, data), footer: fill(copy.footer, data) }),
  });
}

/** Instant notification to members who chose INSTANT. */
export async function notifyNewEntry(entryId: string): Promise<number> {
  const entry = await withPlatform((tx) => tx.entry.findUnique({ where: { id: entryId }, include: { campaign: true } }));
  if (!entry) return 0;
  const members = await withPlatform((tx) => tx.membership.findMany({ where: { orgId: entry.orgId, entryNotifications: "INSTANT" }, include: { user: true } }));
  const url = appUrl(`/app/campaigns/${entry.campaignId}/entries`);
  const pending = entry.status === "PENDING";
  for (const m of members) {
    await deliver({
      orgId: entry.orgId, entryId, kind: "ADMIN_ENTRY", to: m.user.email, contributor: false,
      subject: pending ? `New entry awaiting approval: ${entry.campaign.name}` : `New entry: ${entry.campaign.name}`,
      react: React.createElement(AdminEntriesEmail, { heading: pending ? "A new entry needs your approval" : "A new certificate was issued", lines: [`${entry.name} · ${entry.campaign.name}`], actionLabel: pending ? "Review entry" : "Open entries", actionUrl: url }),
    });
  }
  return members.length;
}

/** Daily digest: one email per DAILY member of every org that received entries in the last 24h. */
export async function sendDailyDigests(now = new Date(), onlyOrgId?: string): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const groups = await withPlatform((tx) => tx.entry.groupBy({ by: ["orgId", "campaignId", "status"], where: { createdAt: { gte: since }, ...(onlyOrgId ? { orgId: onlyOrgId } : {}) }, _count: true }));
  const byOrg = new Map<string, typeof groups>();
  for (const g of groups) byOrg.set(g.orgId, [...(byOrg.get(g.orgId) ?? []), g]);
  let sent = 0;
  for (const [orgId, rows] of byOrg) {
    const [members, campaigns] = await withPlatform((tx) => Promise.all([
      tx.membership.findMany({ where: { orgId, entryNotifications: "DAILY" }, include: { user: true } }),
      tx.campaign.findMany({ where: { id: { in: rows.map((r) => r.campaignId) } }, select: { id: true, name: true } }),
    ]));
    if (!members.length) continue;
    const name = (id: string) => campaigns.find((c) => c.id === id)?.name ?? "Campaign";
    const lines = rows.map((r) => `${name(r.campaignId)}: ${r._count} ${r.status.toLowerCase()}`);
    const total = rows.reduce((n, r) => n + r._count, 0);
    for (const m of members) {
      await deliver({
        orgId, kind: "ADMIN_DIGEST", to: m.user.email, contributor: false, subject: `${total} new ${total === 1 ? "entry" : "entries"} in the last 24 hours`,
        react: React.createElement(AdminEntriesEmail, { heading: `${total} new ${total === 1 ? "entry" : "entries"} yesterday`, lines, actionLabel: "Open dashboard", actionUrl: appUrl("/app") }),
      });
      sent++;
    }
  }
  return sent;
}
