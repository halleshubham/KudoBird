import { prisma, withPlatform } from "./db";
import { ensureDefaultPlan } from "./entitlements";
import { BUNDLED_FONTS } from "./fonts/curated";
import { PRESET_INFO, PRESETS, presetDesign } from "./render/presets";

/**
 * Data every installation needs, safe to run on every start (idempotent): the Free plan, the bundled-font rows and the
 * starter template gallery. Shared by `pnpm db:seed` (development, adds demo data on top) and the production bootstrap.
 */
export async function ensureReferenceData() {
  const plan = await withPlatform((tx) => ensureDefaultPlan(tx));

  for (const family of BUNDLED_FONTS) {
    await prisma.font.upsert({
      where: { family }, update: { bundled: true, curated: true },
      create: { family, category: family.includes("Serif") || family.includes("Tiro") ? "serif" : "sans-serif", subsets: ["devanagari", "latin"], weights: [400, 700], popularity: 1, curated: true, bundled: true },
    });
  }

  await withPlatform(async (tx) => {
    for (const p of PRESETS) {
      if (await tx.template.findFirst({ where: { orgId: null, preset: p } })) continue;
      const t = await tx.template.create({ data: { orgId: null, name: PRESET_INFO[p].name, description: PRESET_INFO[p].description, preset: p } });
      await tx.templateVersion.create({ data: { templateId: t.id, orgId: null, version: 1, design: presetDesign(p, "en") as object } });
    }
  });
  return { plan };
}

/**
 * Promotes the operator-listed addresses (env SUPER_ADMIN_EMAILS, comma separated) to platform super admin on every start. Idempotent, promote-only:
 * removing an address from the list does not demote it (use the admin screens). A missing account is created WITHOUT a password and marked
 * verified because the operator vouched for it; the person signs in with "Email me a sign-in link" (which needs their inbox) and must enrol 2FA.
 */
export async function ensureSuperAdmins(list: string | undefined): Promise<string[]> {
  const emails = [...new Set((list ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  for (const email of emails) {
    await prisma.user.upsert({
      where: { email },
      create: { email, isSuperAdmin: true, emailVerifiedAt: new Date() },
      update: { isSuperAdmin: true, emailVerifiedAt: new Date() },
    });
  }
  return emails;
}
