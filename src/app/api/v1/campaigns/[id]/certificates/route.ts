import { api, pageParams } from "@/server/api/http";
import { listCertificates } from "@/server/api/v1";

export const GET = api<{ id: string }>("read", async ({ ctx, params, query }) => { const { page, perPage } = pageParams(query); return { body: await listCertificates(ctx, params.id, page, perPage) }; });
