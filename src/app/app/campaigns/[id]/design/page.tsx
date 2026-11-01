import { CampaignTabs } from "@/components/Tabs";
import { listAssets } from "@/server/assets";
import { getCampaign, getTemplateDesign, listSignatories } from "@/server/campaigns/service";
import { can } from "@/server/permissions";
import { PRESET_INFO, PRESETS, presetDesign } from "@/server/render/presets";
import { requireOrg } from "@/server/session";
import { saveDesignAction } from "../../actions";
import { Designer } from "./Designer";
import { OrgError } from "@/server/orgs";

export default async function DesignTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, role } = await requireOrg("campaigns.view");
  const c = await getCampaign(ctx, id);
  if (!c.templateId) throw new OrgError("NOT_FOUND", "This campaign has no template");
  const [tpl, logos, signatories] = await Promise.all([getTemplateDesign(ctx, c.templateId), listAssets(ctx, "LOGO"), listSignatories(ctx)]);
  const locale = (["mr", "hi", "en"].includes(c.locale) ? c.locale : "en") as "mr" | "hi" | "en";
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{c.name}</h1>
      <CampaignTabs id={id} active="design" />
      <Designer
        campaignId={id} templateId={c.templateId} initial={tpl.design} version={tpl.version} canEdit={can(role, "templates.manage")}
        presets={PRESETS.map((p) => ({ key: p, ...PRESET_INFO[p], design: presetDesign(p, locale) }))}
        logos={logos.map((l) => ({ id: l.id, filename: l.filename }))}
        signatories={signatories.map((s) => ({ id: s.id, name: s.name, designation: s.designation, assetId: s.assetId }))}
        selectedSignatoryIds={c.signatories.map((s) => s.signatoryId)}
        save={saveDesignAction}
      />
    </div>
  );
}
