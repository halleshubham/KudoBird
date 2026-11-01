import { CampaignTabs } from "@/components/Tabs";
import { getCampaign } from "@/server/campaigns/service";
import { requireOrg } from "@/server/session";
import { commitBulkAction, previewBulkAction } from "../../bulk-actions";
import { BulkUploader } from "./BulkUploader";

export default async function BulkTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireOrg("entries.manage");
  const c = await getCampaign(ctx, id);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{c.name}</h1>
      <CampaignTabs id={id} active="bulk" />
      <BulkUploader campaignId={id} actions={{ preview: previewBulkAction, commit: commitBulkAction }} />
    </div>
  );
}
