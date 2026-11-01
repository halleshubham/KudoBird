import { api } from "@/server/api/http";
import { getUsageSummary } from "@/server/api/v1";

export const GET = api("read", async ({ ctx }) => ({ body: await getUsageSummary(ctx) }));
