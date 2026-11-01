import { randomUUID } from "node:crypto";
import { Prisma, type EntryStatus } from "@prisma/client";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, sha256 } from "../crypto";
import { withPlatform, withTenant } from "../db";
import { assertWithinLimit, EntitlementError } from "../entitlements";
import { OrgError, type OrgContext } from "../orgs";
import { assertCan } from "../permissions";
import { presetDesign, type Preset } from "../render/presets";
import { designSchema, type Design } from "../render/design";
import { slugify } from "../slug";
import { getCaptcha } from "../security/captcha";
import { checkOtpToken } from "../security/otp";
import { rateLimit } from "../security/ratelimit";
import { issueCertificateTx } from "../certificates/issue";
import { enqueueEmail, enqueueRender } from "../queue";
import { entryPayload } from "../webhook-payloads";
import { queueWebhookEventTx } from "../webhooks";
import { maskEmail, maskMobile } from "./countries";
import { fieldsSchema, parseFields, parseSettings, settingsSchema, type CampaignSettings, type FormField, type Locale } from "./schema";
import { validateEntry, type ValidEntry } from "./validation";

const actor = (ctx: OrgContext) => ({ actorId: ctx.userId, impersonatorId: ctx.impersonatorId });

// ------------------------------------------------------------------ templates

export async function saveTemplateDesign(ctx: OrgContext, templateId: string, designRaw: unknown) {
  assertCan(ctx.role, "templates.manage");
  const design = designSchema.parse(designRaw);
  return withTenant(ctx, async (tx) => {
    const tpl = await tx.template.findFirst({ where: { id: templateId, orgId: ctx.orgId } }); // global templates are not editable
    if (!tpl) throw new OrgError("NOT_FOUND", "Template not found");
    const version = tpl.latestVersion + 1;
    // A new immutable version: certificates already issued keep pointing at the version they used.
    await tx.templateVersion.create({ data: { templateId, orgId: ctx.orgId, version, design: design as object, createdById: ctx.userId } });
    await tx.template.update({ where: { id: templateId }, data: { latestVersion: version } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "template.versioned", entity: "Template", entityId: templateId, meta: { version } });
    return { version };
  });
}

export async function getTemplateDesign(ctx: OrgContext, templateId: string, version?: number): Promise<{ design: Design; version: number; name: string; editable: boolean }> {
  return withTenant(ctx, async (tx) => {
    const tpl = await tx.template.findUnique({ where: { id: templateId } });
    if (!tpl) throw new OrgError("NOT_FOUND", "Template not found");
    const v = await tx.templateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId, version: version ?? tpl.latestVersion } } });
    return { design: designSchema.parse(v.design), version: v.version, name: tpl.name, editable: tpl.orgId === ctx.orgId };
  });
}

export async function listTemplates(ctx: OrgContext) {
  return withTenant(ctx, (tx) => tx.template.findMany({ orderBy: [{ orgId: "asc" }, { name: "asc" }] }));
}

/** Copies any visible template (global gallery or own) into the org as a new editable template. */
export async function cloneTemplate(ctx: OrgContext, templateId: string, name?: string) {
  assertCan(ctx.role, "templates.manage");
  return withTenant(ctx, async (tx) => {
    const src = await tx.template.findUnique({ where: { id: templateId } });
    if (!src) throw new OrgError("NOT_FOUND", "Template not found");
    const v = await tx.templateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId, version: src.latestVersion } } });
    const copy = await tx.template.create({ data: { orgId: ctx.orgId, name: name ?? `${src.name} (copy)`, description: src.description, preset: src.preset } });
    await tx.templateVersion.create({ data: { templateId: copy.id, orgId: ctx.orgId, version: 1, design: v.design as object, createdById: ctx.userId } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "template.cloned", entity: "Template", entityId: copy.id, meta: { from: templateId } });
    return copy;
  });
}

// ------------------------------------------------------------------ campaigns

export interface CreateCampaignInput { name: string; locale: Locale; preset: Preset; numberPrefix?: string; description?: string }

const prefixFrom = (name: string) => {
  const latin = name.normalize("NFKD").replace(/[^A-Za-z ]/g, "").trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase();
  return (latin || "CERT").slice(0, 5);
};

export async function createCampaign(ctx: OrgContext, input: CreateCampaignInput) {
  assertCan(ctx.role, "campaigns.manage");
  const base = slugify(input.name);
  const prefix = (input.numberPrefix ?? prefixFrom(input.name)).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (!prefix) throw new OrgError("INVALID", "Certificate number prefix is required");
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
    try {
      return await withTenant(ctx, async (tx) => {
        await assertWithinLimit(tx, ctx.orgId, "campaigns");
        const tpl = await tx.template.create({ data: { orgId: ctx.orgId, name: `${input.name} design`, preset: input.preset } });
        await tx.templateVersion.create({ data: { templateId: tpl.id, orgId: ctx.orgId, version: 1, design: presetDesign(input.preset, input.locale) as object, createdById: ctx.userId } });
        const c = await tx.campaign.create({
          data: {
            orgId: ctx.orgId, name: input.name.trim(), slug, description: input.description, locale: input.locale, numberPrefix: prefix, templateId: tpl.id,
            settings: settingsSchema.parse({ languages: input.locale === "en" ? ["en", "mr", "hi"] : [input.locale, ...(["mr", "hi", "en"] as const).filter((l) => l !== input.locale)] }) as object,
            formFields: [],
          },
        });
        await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "campaign.created", entity: "Campaign", entityId: c.id, meta: { name: c.name } });
        return c;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new OrgError("SLUG_TAKEN", "Could not allocate a unique campaign address");
}

export async function listCampaigns(ctx: OrgContext) {
  assertCan(ctx.role, "campaigns.view");
  return withTenant(ctx, (tx) =>
    tx.campaign.findMany({ where: { orgId: ctx.orgId, archivedAt: null }, orderBy: { createdAt: "desc" }, include: { _count: { select: { entries: true } } } }),
  );
}

export async function getCampaign(ctx: OrgContext, id: string) {
  assertCan(ctx.role, "campaigns.view");
  return withTenant(ctx, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id, orgId: ctx.orgId, archivedAt: null }, include: { signatories: { orderBy: { position: "asc" }, include: { signatory: true } } } });
    if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
    return { ...c, settings: parseSettings(c.settings), formFields: parseFields(c.formFields) };
  });
}

export async function updateCampaign(
  ctx: OrgContext,
  id: string,
  patch: { name?: string; description?: string | null; status?: "DRAFT" | "ACTIVE" | "CLOSED"; locale?: Locale; numberPrefix?: string; settings?: unknown; formFields?: unknown },
) {
  assertCan(ctx.role, "campaigns.manage");
  const data: Prisma.CampaignUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.status) data.status = patch.status;
  if (patch.locale) data.locale = patch.locale;
  if (patch.numberPrefix) data.numberPrefix = patch.numberPrefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (patch.settings !== undefined) data.settings = settingsSchema.parse(patch.settings) as object;
  if (patch.formFields !== undefined) data.formFields = fieldsSchema.parse(patch.formFields) as object[];
  return withTenant(ctx, async (tx) => {
    const found = await tx.campaign.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new OrgError("NOT_FOUND", "Campaign not found");
    const c = await tx.campaign.update({ where: { id }, data });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "campaign.updated", entity: "Campaign", entityId: id, meta: { fields: Object.keys(data) } });
    return c;
  });
}

export async function setCampaignSignatories(ctx: OrgContext, campaignId: string, signatoryIds: string[]) {
  assertCan(ctx.role, "campaigns.manage");
  return withTenant(ctx, async (tx) => {
    const c = await tx.campaign.findFirst({ where: { id: campaignId, orgId: ctx.orgId } });
    if (!c) throw new OrgError("NOT_FOUND", "Campaign not found");
    const valid = await tx.signatory.findMany({ where: { id: { in: signatoryIds }, orgId: ctx.orgId }, select: { id: true } });
    const ok = new Set(valid.map((s) => s.id));
    const ordered = signatoryIds.filter((id) => ok.has(id)).slice(0, 4);
    await tx.campaignSignatory.deleteMany({ where: { campaignId } });
    await tx.campaignSignatory.createMany({ data: ordered.map((signatoryId, position) => ({ orgId: ctx.orgId, campaignId, signatoryId, position })) });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "campaign.signatories_set", entity: "Campaign", entityId: campaignId, meta: { count: ordered.length } });
  });
}

// ------------------------------------------------------------------ signatories

export async function listSignatories(ctx: OrgContext) {
  return withTenant(ctx, (tx) => tx.signatory.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "asc" } }));
}

export async function createSignatory(ctx: OrgContext, input: { name: string; designation: string; assetId?: string | null }) {
  assertCan(ctx.role, "signatories.manage");
  return withTenant(ctx, async (tx) => {
    if (input.assetId) {
      const a = await tx.asset.findFirst({ where: { id: input.assetId, orgId: ctx.orgId, kind: "SIGNATURE" } });
      if (!a) throw new OrgError("NOT_FOUND", "Signature image not found");
    }
    const s = await tx.signatory.create({ data: { orgId: ctx.orgId, name: input.name.trim(), designation: input.designation.trim(), assetId: input.assetId ?? null } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "signatory.created", entity: "Signatory", entityId: s.id });
    return s;
  });
}

export async function deleteSignatory(ctx: OrgContext, id: string) {
  assertCan(ctx.role, "signatories.manage");
  await withTenant(ctx, async (tx) => {
    await tx.signatory.deleteMany({ where: { id, orgId: ctx.orgId } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "signatory.deleted", entity: "Signatory", entityId: id });
  });
}

// ------------------------------------------------------------------ public submission

export type SubmitResult =
  | { ok: true; entryId: string; status: EntryStatus; duplicate: boolean; certificateId?: string }
  | { ok: false; code: "NOT_FOUND" | "CLOSED" | "VALIDATION" | "DUPLICATE" | "CAPTCHA" | "RATE" | "OTP" | "LIMIT"; errors?: Record<string, string> };

export interface SubmitInput {
  orgSlug: string;
  campaignSlug: string;
  raw: Record<string, unknown>;
  locale: string;
  ip?: string;
  captchaToken?: string;
  otpToken?: string;
}

/** Public (no account) entry submission: rate limit -> captcha -> validate -> OTP -> duplicate policy -> store. */
export async function submitEntry(input: SubmitInput): Promise<SubmitResult> {
  const campaign = await withPlatform((tx) =>
    tx.campaign.findFirst({ where: { slug: input.campaignSlug, archivedAt: null, org: { slug: input.orgSlug, status: "ACTIVE", deletedAt: null } } }),
  );
  if (!campaign) return { ok: false, code: "NOT_FOUND" };
  if (campaign.status !== "ACTIVE") return { ok: false, code: "CLOSED" };
  const settings = parseSettings(campaign.settings);
  const fields = parseFields(campaign.formFields);
  const ip = input.ip ?? "unknown";

  // Cheap checks first. Limits: 10 submissions / 10 min per IP per campaign, 300 / hour per campaign overall.
  const [perIp, perCampaign] = await Promise.all([
    rateLimit(`submit:${campaign.id}:${sha256(ip)}`, 10, 600),
    rateLimit(`submit:${campaign.id}:all`, 300, 3600),
  ]);
  if (!perIp.allowed || !perCampaign.allowed) return { ok: false, code: "RATE" };
  if (settings.captcha && !(await getCaptcha().verify(input.captchaToken, input.ip))) return { ok: false, code: "CAPTCHA" };

  const v = validateEntry(input.raw, fields, settings, input.locale);
  if (!v.ok) return { ok: false, code: "VALIDATION", errors: v.errors };
  const e = v.value;

  if (settings.otpEnabled && !checkOtpToken(campaign.id, e.mobile, input.otpToken)) return { ok: false, code: "OTP" };

  return persistEntry(campaign, settings, e, { locale: input.locale, ipSeed: ip, source: "form" });
}

export type StoreResult = Extract<SubmitResult, { ok: true }> | { ok: false; code: "DUPLICATE" | "LIMIT" };

/**
 * The shared core of "someone submitted an entry": duplicate policy, store (contact details encrypted), issue the
 * certificate in the same transaction, then queue render and notifications. Used by the public form and the REST API;
 * callers do their own validation and abuse checks first (captcha/rate limits for the form, API key limits for the API).
 */
export async function persistEntry(
  campaign: { id: string; orgId: string; name: string },
  settings: CampaignSettings,
  e: ValidEntry,
  opts: { locale: string; ipSeed: string; source: "form" | "api"; consentText?: string },
): Promise<StoreResult> {
  const mobileHash = blindIndex(e.mobile, campaign.id);
  const existing = await withPlatform((tx) => tx.entry.findFirst({ where: { campaignId: campaign.id, mobileHash }, orderBy: { createdAt: "asc" } }));
  if (existing && settings.duplicateMode === "block") return { ok: false, code: "DUPLICATE" };
  if (existing && settings.duplicateMode === "return_existing") {
    const cert = await withPlatform((tx) => tx.certificate.findUnique({ where: { entryId: existing.id }, select: { publicId: true } }));
    return { ok: true, entryId: existing.id, status: existing.status, duplicate: true, certificateId: cert?.publicId };
  }

  const status: EntryStatus = settings.approvalMode ? "PENDING" : "APPROVED";
  const consentText = opts.consentText ?? settings.consentText[opts.locale as Locale] ?? null;
  // Entry and certificate commit together, so an entry is never left approved-but-unnumbered.
  let issued: { id: string; publicId: string; created: boolean } | undefined;
  let entry;
  try {
    entry = await withPlatform(async (tx) => {
      const created = await tx.entry.create({
        data: {
          orgId: campaign.orgId, campaignId: campaign.id, name: e.name,
          mobileEnc: encrypt(e.mobile), mobileHash,
          emailEnc: e.email ? encrypt(e.email) : null, emailHash: e.email ? blindIndex(e.email, campaign.orgId) : null,
          customData: e.custom, status, consentAt: e.consent ? new Date() : null, consentText, wallOptIn: e.wallOptIn && settings.wallEnabled,
          locale: opts.locale, ipHash: sha256(opts.ipSeed + campaign.id),
        },
      });
      await audit(tx, { orgId: campaign.orgId, action: "entry.created", entity: "Entry", entityId: created.id, meta: { campaignId: campaign.id, status, source: opts.source } });
      await queueWebhookEventTx(tx, campaign.orgId, "entry.created", async (pii) => entryPayload(created, campaign.name, pii));
      if (status === "APPROVED") issued = await issueCertificateTx(tx, created.id);
      return created;
    });
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, code: "LIMIT" };
    throw err;
  }
  if (issued?.created) await enqueueRender(issued.id);
  await enqueueEmail({ kind: "entry-notify", id: entry.id });
  return { ok: true, entryId: entry.id, status: entry.status, duplicate: false, certificateId: issued?.publicId };
}

// ------------------------------------------------------------------ entries (org side)

export async function listEntries(ctx: OrgContext, campaignId: string, opts: { q?: string; status?: EntryStatus; page?: number; pageSize?: number } = {}) {
  assertCan(ctx.role, "entries.view");
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const where: Prisma.EntryWhereInput = {
    orgId: ctx.orgId, campaignId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.q ? { name: { contains: opts.q, mode: "insensitive" } } : {}),
  };
  return withTenant(ctx, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.entry.findMany({ where, orderBy: { createdAt: "desc" }, skip: ((opts.page ?? 1) - 1) * pageSize, take: pageSize, include: { certificate: { select: { id: true, publicId: true, number: true, status: true, renderStatus: true } } } }),
      tx.entry.count({ where }),
    ]);
    const logs = await tx.emailLog.findMany({ where: { orgId: ctx.orgId, entryId: { in: rows.map((r) => r.id) }, kind: { in: ["CERTIFICATE", "REJECTED"] } }, orderBy: { createdAt: "desc" } });
    const emailStatus = (id: string) => logs.find((l) => l.entryId === id)?.status ?? null;
    // Contact details are masked in lists; reveal is a separate, audited action.
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id, name: r.name, status: r.status, createdAt: r.createdAt, customData: r.customData as Record<string, string>, certificate: r.certificate, hasEmail: !!r.emailEnc, emailStatus: emailStatus(r.id),
        mobileMasked: maskMobile(decrypt(r.mobileEnc)), emailMasked: r.emailEnc ? maskEmail(decrypt(r.emailEnc)) : null,
      })),
    };
  });
}

export async function revealEntryContact(ctx: OrgContext, entryId: string) {
  assertCan(ctx.role, "entries.view");
  return withTenant(ctx, async (tx) => {
    const r = await tx.entry.findFirst({ where: { id: entryId, orgId: ctx.orgId } });
    if (!r) throw new OrgError("NOT_FOUND", "Entry not found");
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: "entry.contact_revealed", entity: "Entry", entityId: entryId });
    return { mobile: decrypt(r.mobileEnc), email: r.emailEnc ? decrypt(r.emailEnc) : null };
  });
}

export async function reviewEntry(ctx: OrgContext, entryId: string, decision: "APPROVED" | "REJECTED") {
  assertCan(ctx.role, "entries.manage");
  return withTenant(ctx, async (tx) => {
    const r = await tx.entry.findFirst({ where: { id: entryId, orgId: ctx.orgId } });
    if (!r) throw new OrgError("NOT_FOUND", "Entry not found");
    const updated = await tx.entry.update({ where: { id: entryId }, data: { status: decision, reviewedById: ctx.userId, reviewedAt: new Date() } });
    await audit(tx, { orgId: ctx.orgId, ...actor(ctx), action: decision === "APPROVED" ? "entry.approved" : "entry.rejected", entity: "Entry", entityId: entryId });
    const issued = decision === "APPROVED" ? await issueCertificateTx(tx, entryId) : null;
    return { entry: updated, issued };
  }).then(async ({ entry, issued }) => {
    if (issued?.created) await enqueueRender(issued.id);
    if (decision === "REJECTED") await enqueueEmail({ kind: "rejected", id: entryId });
    return entry;
  });
}

export type { CampaignSettings, FormField };
