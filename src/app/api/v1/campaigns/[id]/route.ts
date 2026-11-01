import { api } from "@/server/api/http";
import { getCampaign } from "@/server/api/v1";

export const GET = api<{ id: string }>("read", async ({ ctx, params }) => ({ body: await getCampaign(ctx, params.id) }));
