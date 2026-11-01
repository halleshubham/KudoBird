import { z } from "zod";
import { prisma, withPlatform } from "../db";
import { ensureFont, fontSlug, syncFontCatalogue } from "../fonts";
import { FEATURE_KEYS, LIMIT_KEYS } from "../entitlements";
import { getPlatformSettings, platformSettingsSchema, savePlatformSettings } from "../platform-settings";
import { designSchema } from "../render/design";
import { PRESET_INFO, PRESETS, presetDesign, type Preset } from "../render/presets";
import { assertSuperAdmin, AdminError, platformAudit } from "./guard";
import { Prisma } from "@prisma/client";

// ------------------------------------------------------------------ platform settings
export async function getSettings(adminId: string) { await assertSuperAdmin(adminId); return getPlatformSettings(); }

export async function updateSettings(adminId: string, input: unknown) {
  await assertSuperAdmin(adminId);
  const v = platformSettingsSchema.parse(input);
  return withPlatform(async (tx) => {
    const plan = await tx.plan.findFirst({ where: { key: v.defaultPlanKey, active: true } });
    if (!plan) throw new AdminError("NOT_FOUND", `Plan "${v.defaultPlanKey}" does not exist or is inactive`);
    const before = await getPlatformSettings(tx);
    await savePlatformSettings(v, tx);
    await platformAudit(tx, adminId, "settings.updated", "PlatformSetting", "general", { before, after: v });
    return v;
  });
}

// ------------------------------------------------------------------ plans
const planSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,29}$/, "Key: lowercase letters, digits, - or _"),
  name: z.string().trim().min(2).max(60),
  limits: z.record(z.number().int().min(-1)).refine((l) => Object.keys(l).every((k) => (LIMIT_KEYS as readonly string[]).includes(k)), "Unknown limit key"),
  features: z.record(z.boolean()).refine((f) => Object.keys(f).every((k) => (FEATURE_KEYS as readonly string[]).includes(k)), "Unknown feature key"),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type PlanInput = z.input<typeof planSchema>;

export async function listPlans(adminId: string) {
  await assertSuperAdmin(adminId);
  return withPlatform(async (tx) => {
    const [plans, counts] = await Promise.all([tx.plan.findMany({ orderBy: { createdAt: "asc" } }), tx.organization.groupBy({ by: ["planId"], where: { deletedAt: null }, _count: true })]);
    return plans.map((p) => ({ ...p, orgs: counts.find((c) => c.planId === p.id)?._count ?? 0 }));
  });
}

/**
 * Creates or updates a plan by key. Changing a plan changes limits for every organisation on it (immediately),
 * so this is the lever that turns paid plans on later: edit plan rows, never application code.
 */
export async function upsertPlan(adminId: string, input: unknown) {
  await assertSuperAdmin(adminId);
  const p = planSchema.parse(input);
  return withPlatform(async (tx) => {
    const existing = await tx.plan.findUnique({ where: { key: p.key } });
    if (existing?.isDefault && !p.active) throw new AdminError("INVALID", "The default plan cannot be deactivated; choose another default first");
    if (p.isDefault) await tx.plan.updateMany({ where: { isDefault: true, NOT: { key: p.key } }, data: { isDefault: false } });
    const plan = await tx.plan.upsert({ where: { key: p.key }, create: p, update: { name: p.name, limits: p.limits, features: p.features, isDefault: p.isDefault, active: p.active } });
    await platformAudit(tx, adminId, existing ? "plan.updated" : "plan.created", "Plan", plan.id, { key: p.key, limits: p.limits, features: p.features });
    return plan;
  });
}

// ------------------------------------------------------------------ global templates (the starter gallery)
export async function listGlobalTemplates(adminId: string) {
  await assertSuperAdmin(adminId);
  return withPlatform(async (tx) => {
    const t = await tx.template.findMany({ where: { orgId: null }, orderBy: { createdAt: "asc" }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    return t.map((x) => ({ id: x.id, name: x.name, description: x.description, preset: x.preset, latestVersion: x.latestVersion, design: x.versions[0]?.design ?? null }));
  });
}

export async function createGlobalTemplate(adminId: string, input: { name: string; description?: string; preset: Preset; locale?: "en" | "hi" | "mr" }) {
  await assertSuperAdmin(adminId);
  if (!(PRESETS as readonly string[]).includes(input.preset)) throw new AdminError("INVALID", "Unknown preset");
  const name = input.name.trim();
  if (name.length < 2) throw new AdminError("INVALID", "Name is required");
  return withPlatform(async (tx) => {
    const t = await tx.template.create({ data: { orgId: null, name, description: input.description ?? PRESET_INFO[input.preset].description, preset: input.preset } });
    await tx.templateVersion.create({ data: { templateId: t.id, orgId: null, version: 1, design: presetDesign(input.preset, input.locale ?? "en") as object, createdById: adminId } });
    await platformAudit(tx, adminId, "template.created", "Template", t.id, { name });
    return t;
  });
}

/** New immutable version of a global template. Organisations that already cloned it are unaffected. */
export async function saveGlobalTemplateDesign(adminId: string, templateId: string, designJson: unknown) {
  await assertSuperAdmin(adminId);
  const design = designSchema.parse(typeof designJson === "string" ? JSON.parse(designJson) : designJson);
  return withPlatform(async (tx) => {
    const t = await tx.template.findFirst({ where: { id: templateId, orgId: null } });
    if (!t) throw new AdminError("NOT_FOUND", "Global template not found");
    const version = t.latestVersion + 1;
    await tx.templateVersion.create({ data: { templateId, orgId: null, version, design: design as object, createdById: adminId } });
    await tx.template.update({ where: { id: templateId }, data: { latestVersion: version } });
    await platformAudit(tx, adminId, "template.versioned", "Template", templateId, { version });
    return { version };
  });
}

export async function renameGlobalTemplate(adminId: string, templateId: string, name: string, description?: string) {
  await assertSuperAdmin(adminId);
  if (name.trim().length < 2) throw new AdminError("INVALID", "Name is required");
  await withPlatform(async (tx) => {
    const r = await tx.template.updateMany({ where: { id: templateId, orgId: null }, data: { name: name.trim(), description } });
    if (!r.count) throw new AdminError("NOT_FOUND", "Global template not found");
    await platformAudit(tx, adminId, "template.renamed", "Template", templateId, { name });
  });
}

export async function deleteGlobalTemplate(adminId: string, templateId: string) {
  await assertSuperAdmin(adminId);
  await withPlatform(async (tx) => {
    const t = await tx.template.findFirst({ where: { id: templateId, orgId: null } });
    if (!t) throw new AdminError("NOT_FOUND", "Global template not found");
    await tx.template.delete({ where: { id: templateId } }); // orgs' clones are independent copies and are unaffected
    await platformAudit(tx, adminId, "template.deleted", "Template", templateId, { name: t.name });
  });
}

// ------------------------------------------------------------------ fonts
export async function listFontsAdmin(adminId: string, q: { q?: string; curatedOnly?: boolean; page?: number } = {}) {
  await assertSuperAdmin(adminId);
  const pageSize = 40;
  const where: Prisma.FontWhereInput = { ...(q.q ? { family: { contains: q.q, mode: "insensitive" } } : {}), ...(q.curatedOnly ? { curated: true } : {}) };
  const [rows, total, all] = await Promise.all([
    prisma.font.findMany({ where, orderBy: [{ curated: "desc" }, { popularity: "asc" }], skip: ((q.page ?? 1) - 1) * pageSize, take: pageSize }),
    prisma.font.count({ where }), prisma.font.count(),
  ]);
  return { rows, total, catalogueSize: all, pageSize };
}

export async function setFontCurated(adminId: string, family: string, curated: boolean) {
  await assertSuperAdmin(adminId);
  const f = await prisma.font.findUnique({ where: { family } });
  if (!f) throw new AdminError("NOT_FOUND", "Font not found");
  if (f.bundled && !curated) throw new AdminError("INVALID", "Bundled fonts always stay in the shortlist");
  await prisma.font.update({ where: { family }, data: { curated } });
  await withPlatform((tx) => platformAudit(tx, adminId, curated ? "font.curated" : "font.uncurated", "Font", family));
}

export async function syncFonts(adminId: string) {
  await assertSuperAdmin(adminId);
  const n = await syncFontCatalogue();
  await withPlatform((tx) => platformAudit(tx, adminId, "fonts.synced", "Font", undefined, { count: n }));
  return n;
}

/** Downloads a font to the server cache now, so the first render that uses it never needs the network. */
export async function precacheFont(adminId: string, family: string) {
  await assertSuperAdmin(adminId);
  if (!(await prisma.font.findUnique({ where: { family } }))) throw new AdminError("NOT_FOUND", "Font not found in the catalogue");
  const { manifest } = await ensureFont(family, [400, 700]);
  await withPlatform((tx) => platformAudit(tx, adminId, "font.cached", "Font", family, { files: manifest.faces.length }));
  return { slug: fontSlug(family), files: manifest.faces.length };
}

// ------------------------------------------------------------------ audit trails
export async function listPlatformAudit(adminId: string, q: { action?: string; page?: number } = {}) {
  await assertSuperAdmin(adminId);
  const pageSize = 50;
  const where: Prisma.PlatformAuditWhereInput = q.action ? { action: { startsWith: q.action } } : {};
  const [rows, total] = await Promise.all([prisma.platformAudit.findMany({ where, orderBy: { createdAt: "desc" }, skip: ((q.page ?? 1) - 1) * pageSize, take: pageSize }), prisma.platformAudit.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, email: true } });
  return { total, pageSize, rows: rows.map((r) => ({ ...r, actorEmail: users.find((u) => u.id === r.actorId)?.email ?? "unknown" })) };
}

/** Org audit logs across every organisation (super admin only). */
export async function listAllOrgAudit(adminId: string, q: { orgId?: string; action?: string; page?: number } = {}) {
  await assertSuperAdmin(adminId);
  const pageSize = 50;
  const where: Prisma.AuditLogWhereInput = { ...(q.orgId ? { orgId: q.orgId } : {}), ...(q.action ? { action: { startsWith: q.action } } : {}) };
  return withPlatform(async (tx) => {
    const [rows, total] = await Promise.all([tx.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: ((q.page ?? 1) - 1) * pageSize, take: pageSize, include: { org: { select: { name: true } } } }), tx.auditLog.count({ where })]);
    const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.impersonatorId]).filter(Boolean) as string[])];
    const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
    const em = (id: string | null) => (id ? users.find((u) => u.id === id)?.email ?? "unknown" : null);
    return { total, pageSize, rows: rows.map((r) => ({ ...r, orgName: r.org.name, actorEmail: em(r.actorId), impersonatorEmail: em(r.impersonatorId) })) };
  });
}
