import { CampaignTabs } from "@/components/Tabs";
import { getCampaign } from "@/server/campaigns/service";
import { requireOrg } from "@/server/session";
import { updateFieldsAction } from "../../actions";
import { FieldsEditor } from "./FieldsEditor";

export default async function FormTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireOrg("campaigns.view");
  const c = await getCampaign(ctx, id);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{c.name}</h1>
      <CampaignTabs id={id} active="form" />
      <FieldsEditor campaignId={id} initial={c.formFields} action={updateFieldsAction} />
    </div>
  );
}
