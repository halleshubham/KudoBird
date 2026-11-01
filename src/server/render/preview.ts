import QRCode from "qrcode";
import { withTenant } from "../db";
import { parseSettings } from "../campaigns/schema";
import { fontFaceCss } from "../fonts";
import { OrgError, type OrgContext } from "../orgs";
import { designFonts, designSchema, type Design } from "./design";
import { renderCertificateHtml } from "./html";
import { OUTPUT_SIZES, type OutputSize } from "./sizes";

export const SAMPLE_NAMES: Record<string, string> = { mr: "बळीराजा पाटील", hi: "अनुराधा शर्मा", en: "Aarav Sharma" };

/** Live-preview HTML with sample data. Images/fonts are referenced by same-origin URL (cheap to update). */
export async function buildPreviewHtml(ctx: OrgContext, input: { campaignId: string; design: unknown; size?: OutputSize }): Promise<string> {
  const design: Design = designSchema.parse(input.design);
  const { campaign, sigs, org } = await withTenant(ctx, async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id: input.campaignId, orgId: ctx.orgId },
      include: { signatories: { orderBy: { position: "asc" }, include: { signatory: true } } },
    });
    if (!campaign) throw new OrgError("NOT_FOUND", "Campaign not found");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    return { campaign, org, sigs: campaign.signatories.map((s) => s.signatory) };
  });
  const settings = parseSettings(campaign.settings);
  void settings;
  const size = OUTPUT_SIZES[input.size ?? "square"];
  const assets: Record<string, string> = {};
  for (const id of [...design.logos.assetIds, design.background.assetId].filter(Boolean) as string[]) assets[id] = `/api/assets/${id}`;
  const qrSrc = await QRCode.toDataURL("https://example.com/c/sample", { margin: 0, width: 240 });
  const locale = campaign.locale;
  const fontCss = await fontFaceCss(designFonts(design), "url");
  return renderCertificateHtml({
    design,
    data: {
      name: SAMPLE_NAMES[locale] ?? SAMPLE_NAMES.en, campaign: campaign.name, org: org.name,
      date: new Intl.DateTimeFormat(locale === "en" ? "en-IN" : locale === "hi" ? "hi-IN" : "mr-IN", { dateStyle: "long" }).format(new Date()),
      certificate_no: `${campaign.numberPrefix}-${new Date().getFullYear()}-00001`,
    },
    assets,
    signatories: sigs.map((s) => ({ name: s.name, designation: s.designation, imageSrc: s.assetId ? `/api/assets/${s.assetId}` : null })),
    qrSrc,
    size,
    fontCss,
  });
}
