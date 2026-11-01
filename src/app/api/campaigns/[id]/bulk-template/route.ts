import { NextResponse } from "next/server";
import { bulkTemplateCsv } from "@/server/bulk";
import { getCampaign } from "@/server/campaigns/service";
import { requireOrg } from "@/server/session";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireOrg("entries.manage");
  const c = await getCampaign(ctx, (await params).id);
  return new NextResponse(bulkTemplateCsv(c.formFields), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${c.slug}-bulk-template.csv"` } });
}
