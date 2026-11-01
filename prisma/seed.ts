/* Seeds: Free plan, global starter templates, font catalogue entries for the bundled fonts,
 * a super admin and a demo organisation with a Marathi campaign that works immediately.
 * Idempotent: safe to run repeatedly.
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD  -> super admin (defaults for local dev below)
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/server/crypto";
import { prisma, withPlatform } from "../src/server/db";
import { ensureDefaultPlan } from "../src/server/entitlements";
import { BUNDLED_FONTS } from "../src/server/fonts/curated";
import { PRESET_INFO, PRESETS, presetDesign } from "../src/server/render/presets";
import { getStorage } from "../src/server/storage";
import { settingsSchema } from "../src/server/campaigns/schema";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="92" fill="#fff7e6" stroke="#b45309" stroke-width="8"/><path d="M100 40c18 22 38 34 38 62a38 38 0 0 1-76 0c0-28 20-40 38-62z" fill="#ea580c"/><path d="M100 78c9 11 19 17 19 31a19 19 0 0 1-38 0c0-14 10-20 19-31z" fill="#fde68a"/></svg>`;
const sig = (path: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" fill="none" stroke="#1e3a8a" stroke-width="3" stroke-linecap="round"><path d="${path}"/></svg>`;
const SIG1 = sig("M10 70c20-50 40-60 50-30s-20 50 5 40 30-40 50-35 0 40 25 25 30-30 50-10 25 25 60 0");
const SIG2 = sig("M12 60c30-40 25 30 45-5s20-30 30 0 25 30 45-10 30 20 60-5 30 5 70-15");

async function asset(orgId: string, kind: "LOGO" | "SIGNATURE", filename: string, svg: string) {
  const id = randomUUID();
  const key = `${orgId}/${id}.svg`;
  await getStorage().put(key, Buffer.from(svg), "image/svg+xml");
  return withPlatform((tx) => tx.asset.create({ data: { id, orgId, kind, storageKey: key, mime: "image/svg+xml", bytes: svg.length, filename } }));
}

async function main() {
  const plan = await withPlatform((tx) => ensureDefaultPlan(tx));

  // bundled fonts are always listed even before `pnpm fonts:sync`
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

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@kudobird.local").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin-password-123";
  await prisma.user.upsert({
    where: { email: adminEmail }, update: {},
    create: { email: adminEmail, name: "Platform Admin", passwordHash: await hashPassword(adminPassword), isSuperAdmin: true, emailVerifiedAt: new Date() },
  });

  const exists = await withPlatform((tx) => tx.organization.findUnique({ where: { slug: "demo" } }));
  if (!exists) {
    const owner = await prisma.user.upsert({
      where: { email: "demo@kudobird.local" }, update: {},
      create: { email: "demo@kudobird.local", name: "Demo Owner", passwordHash: await hashPassword("demo-password-123"), emailVerifiedAt: new Date() },
    });
    const org = await withPlatform(async (tx) => {
      const o = await tx.organization.create({ data: { name: "Shetkari Sanvad Foundation", slug: "demo", planId: plan.id, primaryColor: "#b45309" } });
      await tx.membership.create({ data: { orgId: o.id, userId: owner.id, role: "OWNER" } });
      await tx.subscription.create({ data: { orgId: o.id, planId: plan.id } });
      return o;
    });
    const logo = await asset(org.id, "LOGO", "placeholder-logo.svg", LOGO_SVG);
    const s1 = await asset(org.id, "SIGNATURE", "signature-1.svg", SIG1);
    const s2 = await asset(org.id, "SIGNATURE", "signature-2.svg", SIG2);
    await withPlatform(async (tx) => {
      const sig1 = await tx.signatory.create({ data: { orgId: org.id, name: "डॉ. सुनील देशमुख", designation: "अध्यक्ष", assetId: s1.id } });
      const sig2 = await tx.signatory.create({ data: { orgId: org.id, name: "सौ. अनिता पाटील", designation: "सचिव", assetId: s2.id } });
      const design = presetDesign("festive", "mr");
      design.logos.assetIds = [logo.id];
      design.blocks.title.text = "बळीराजाची दिवाळी";
      design.blocks.subtitle.text = "कृतज्ञता प्रमाणपत्र: हे प्रमाणपत्र सन्मानपूर्वक प्रदान करण्यात येत आहे";
      design.blocks.body.text = "{{village}} येथील दुष्काळग्रस्त शेतकरी कुटुंबांसाठी आपण दिलेल्या बहुमोल योगदानाबद्दल कृतज्ञतापूर्वक. श्री {{name}} यांचे मनःपूर्वक आभार.";
      const tpl = await tx.template.create({ data: { orgId: org.id, name: "बळीराजाची दिवाळी design", preset: "festive" } });
      await tx.templateVersion.create({ data: { templateId: tpl.id, orgId: org.id, version: 1, design: design as object } });
      const campaign = await tx.campaign.create({
        data: {
          orgId: org.id, name: "बळीराजाची दिवाळी", slug: "baliraja-diwali", description: "दुष्काळग्रस्त शेतकरी कुटुंबांसाठी दिवाळी भेट मोहीम. तुमचे योगदान नोंदवा आणि प्रमाणपत्र मिळवा.",
          status: "ACTIVE", locale: "mr", numberPrefix: "BD", templateId: tpl.id,
          settings: settingsSchema.parse({ captcha: false, wallEnabled: true, hashtags: ["बळीराजाचीदिवाळी", "KudoBird"], shareText: "मी '{{campaign}}' मध्ये योगदान दिले! {{url}}" }) as object,
          formFields: [{ key: "village", label: "Village", translations: { hi: "गाँव", mr: "गाव" }, type: "text", required: false, options: [], showOnCertificate: true }],
        },
      });
      await tx.campaignSignatory.createMany({ data: [{ orgId: org.id, campaignId: campaign.id, signatoryId: sig1.id, position: 0 }, { orgId: org.id, campaignId: campaign.id, signatoryId: sig2.id, position: 1 }] });
    });
    console.log("Demo org ready:  demo@kudobird.local / demo-password-123  ->  /o/demo/baliraja-diwali");
  }
  console.log(`Super admin:     ${adminEmail} / ${adminPassword}  (change it; 2FA is forced at first sign-in)`);
}
main().finally(() => prisma.$disconnect());
