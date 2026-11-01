import { withTenant } from "../db";
import { appUrl } from "../urls";
import { OrgError, type OrgContext } from "../orgs";
import { parseFields, parseSettings, type Locale } from "../campaigns/schema";
import { persistEntry } from "../campaigns/service";
import { validateEntry } from "../campaigns/validation";
import { revokeCertificate } from "../certificates/issue";
import { revealContact } from "../pii";
import { currentPeriod, getUsage, LIMIT_KEYS, loadEntitlements } from "../entitlements";

import { assertCan } from "../permissions";
import { certificateUrls } from "../webhook-payloads";
import { pageArgs } from "../paginate";
import { ApiError, pagination } from "./http";
import type { EntryStatus, Prisma } from "@prisma/client";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (id: string) => { if (!uuid.test(id)) throw new OrgError("NOT_FOUND", "Not found"); return id; };

// ------------------------------------------------------------------ shapes

const renderState = (s: string) => (s === "READY" ? "ready" : s === "FAILED" ? "failed" : "processing");

export function certificateShape(c: { publicId: string; number: string; status: string; renderStatus: string; issuedAt: Date; revokedAt: Date | null; revokeReason: string | null; campaignId: string; entryId: string; renderData: unknown; outputs: unknown }) {
  const ready = Object.keys((c.outputs as object) ?? {});
  return {
    id: c.publicId, number: c.number, status: c.status.toLowerCase(), name: (c.renderData as Record<string, string>).name, campaign_id: c.campaignId, entry_id: c.entryId,
    issued_at: c.issuedAt.toISOString(), revoked_at: c.revokedAt?.toISOString() ?? null, revoke_reason: c.revokeReason,
    render_status: renderState(c.renderStatus), ...certificateUrls(c.publicId), available_images: ready,
  };
}

function campaignShape(c: { id: string; name: string; slug: string; status: string; locale: string; numberPrefix: string; description: string | null; settings: unknown; formFields: unknown; createdAt: Date }, orgSlug: string) {
  const s = parseSettings(c.settings);
  return {
    id: c.id, name: c.name, slug: c.slug, description: c.description, status: c.status.toLowerCase(), language: c.locale, certificate_number_prefix: c.numberPrefix,
    form_url: appUrl(`/o/${orgSlug}/${c.slug}`), approval_mode: s.approvalMode, duplicate_policy: s.duplicateMode, mobile_country: s.mobileCountry,
    custom_fields: parseFields(c.formFields).map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options })), created_at: c.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------------ reads

export async function listCampaigns(ctx: OrgContext, page: number, perPage: number) {
  assertCan(ctx.role, "campaigns.view");
  return withTenant(ctx, async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const where = { orgId: ctx.orgId, archivedAt: null };
    const [rows, total] = await Promise.all([tx.campaign.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(page, perPage) }), tx.campaign.count({ where })]);
    return { data: rows.map((c) => campaignShape(c, org.slug)), pagination: pagination(page, perPage, total) };
  });
}

export async function getCampaign(ctx: OrgContext, id: string) {
  assertCan(ctx.role, "campaigns.view");
  requireUuid(id);
  return withTenant(ctx, async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const c = await tx.campaign.findFirst({ where: { id, orgId: ctx.orgId, archivedAt: null } });
    if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
    return { data: campaignShape(c, org.slug) };
  });
}

export async function listEntries(ctx: OrgContext, campaignId: string, q: { status?: string; q?: string; page: number; perPage: number }, includeContact: boolean) {
  assertCan(ctx.role, "entries.view");
  requireUuid(campaignId);
  const status = q.status ? (q.status.toUpperCase() as EntryStatus) : undefined;
  if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status)) throw new ApiError(422, "validation_failed", "status must be pending, approved or rejected");
  return withTenant(ctx, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id: campaignId, orgId: ctx.orgId, archivedAt: null }, select: { id: true } });
    if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
    const where: Prisma.EntryWhereInput = { orgId: ctx.orgId, campaignId, ...(status ? { status } : {}), ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}) };
    const [rows, total] = await Promise.all([
      tx.entry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.perPage, take: q.perPage, include: { certificate: true } }),
      tx.entry.count({ where }),
    ]);
    return {
      data: rows.map((e) => ({
        id: e.id, name: e.name, status: e.status.toLowerCase(), language: e.locale, created_at: e.createdAt.toISOString(), custom_fields: e.customData,
        certificate: e.certificate ? { id: e.certificate.publicId, number: e.certificate.number, status: e.certificate.status.toLowerCase(), url: appUrl(`/c/${e.certificate.publicId}`) } : null,
        // Contact details are returned only to keys that were explicitly granted the "pii" scope.
        ...(includeContact ? { contact: revealContact(e) } : {}),
      })),
      pagination: pagination(q.page, q.perPage, total),
    };
  });
}

export async function listCertificates(ctx: OrgContext, campaignId: string, page: number, perPage: number) {
  assertCan(ctx.role, "entries.view");
  requireUuid(campaignId);
  return withTenant(ctx, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id: campaignId, orgId: ctx.orgId, archivedAt: null }, select: { id: true } });
    if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
    const where = { orgId: ctx.orgId, campaignId };
    const [rows, total] = await Promise.all([tx.certificate.findMany({ where, orderBy: { issuedAt: "desc" }, ...pageArgs(page, perPage) }), tx.certificate.count({ where })]);
    return { data: rows.map(certificateShape), pagination: pagination(page, perPage, total) };
  });
}

export async function getCertificate(ctx: OrgContext, publicId: string) {
  assertCan(ctx.role, "entries.view");
  return withTenant(ctx, async (tx) => {
    const c = await tx.certificate.findFirst({ where: { orgId: ctx.orgId, OR: [{ publicId }, { number: publicId }] } });
    if (!c) throw new OrgError("NOT_FOUND", "Certificate not found");
    return { data: certificateShape(c) };
  });
}

export async function getUsageSummary(ctx: OrgContext) {
  assertCan(ctx.role, "stats.view");
  return withTenant(ctx, async (tx) => {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { plan: true } });
    const ent = await loadEntitlements(tx, ctx.orgId);
    const usage = Object.fromEntries(await Promise.all(LIMIT_KEYS.map(async (k) => [k, await getUsage(tx, ctx.orgId, k)])));
    return { data: { plan: { key: org.plan.key, name: org.plan.name }, period: currentPeriod(), usage, limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, ent.limits[k] ?? -1])), features: ent.features } };
  });
}

// ------------------------------------------------------------------ writes

const LANGS = ["mr", "hi", "en"];
const API_CONSENT = "Collected through the API: consent attested by the organisation";

/**
 * Creates an entry (and, unless the campaign needs approval, its certificate). Goes through exactly the same core as the
 * public form (`persistEntry`), so duplicate policy, plan limits, numbering and webhooks behave identically.
 */
export async function createEntry(ctx: OrgContext, campaignId: string, body: Record<string, unknown>) {
  assertCan(ctx.role, "entries.manage");
  requireUuid(campaignId);
  const campaign = await withTenant(ctx, (tx) => tx.campaign.findFirst({ where: { id: campaignId, orgId: ctx.orgId, archivedAt: null } }));
  if (!campaign) throw new OrgError("NOT_FOUND", "Campaign not found");
  if (campaign.status !== "ACTIVE") throw new ApiError(409, "campaign_not_active", "The campaign is not active. Set it to Active before adding entries.");
  if (body.consent !== true) throw new ApiError(422, "validation_failed", 'Set "consent": true to confirm the person agreed to their details being used', { consent: "required" });
  const language = typeof body.language === "string" ? body.language : campaign.locale;
  if (!LANGS.includes(language)) throw new ApiError(422, "validation_failed", "language must be one of mr, hi, en", { language: "invalid" });
  const custom = body.custom_fields && typeof body.custom_fields === "object" && !Array.isArray(body.custom_fields) ? (body.custom_fields as Record<string, unknown>) : {};
  const settings = parseSettings(campaign.settings);
  const raw: Record<string, unknown> = { ...custom, name: body.name, mobile: body.mobile, email: body.email ?? "", consent: "on", wallOptIn: body.wall_opt_in === true ? "on" : "" };
  const v = validateEntry(raw, parseFields(campaign.formFields), settings, language);
  if (!v.ok) throw new ApiError(422, "validation_failed", "Some fields are invalid", v.errors);
  const r = await persistEntry(campaign, settings, v.value, { locale: language as Locale, ipSeed: `api:${ctx.userId}`, source: "api", consentText: API_CONSENT });
  if (!r.ok) {
    if (r.code === "DUPLICATE") throw new ApiError(409, "duplicate_entry", "An entry with this mobile number already exists in this campaign");
    throw new ApiError(403, "plan_limit_reached", "The organisation's certificate allowance for this period is used up");
  }
  const cert = r.certificateId ? await withTenant(ctx, (tx) => tx.certificate.findUnique({ where: { publicId: r.certificateId } })) : null;
  return { status: r.duplicate ? 200 : 201, body: { data: { entry: { id: r.entryId, status: r.status.toLowerCase(), duplicate: r.duplicate }, certificate: cert ? certificateShape(cert) : null } } };
}

export async function revoke(ctx: OrgContext, publicId: string, reason: unknown) {
  assertCan(ctx.role, "entries.manage");
  const cert = await withTenant(ctx, (tx) => tx.certificate.findFirst({ where: { publicId, orgId: ctx.orgId } }));
  if (!cert) throw new OrgError("NOT_FOUND", "Certificate not found");
  await revokeCertificate(ctx, cert.id, typeof reason === "string" ? reason : undefined);
  return getCertificate(ctx, publicId);
}

