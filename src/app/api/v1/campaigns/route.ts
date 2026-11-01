import { api, pageParams } from "@/server/api/http";
import { listCampaigns } from "@/server/api/v1";

export const GET = api("read", async ({ ctx, query }) => { const { page, perPage } = pageParams(query); return { body: await listCampaigns(ctx, page, perPage) }; });
