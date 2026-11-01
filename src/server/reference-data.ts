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
