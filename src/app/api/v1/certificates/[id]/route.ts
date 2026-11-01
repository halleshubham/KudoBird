import { api } from "@/server/api/http";
import { getCertificate } from "@/server/api/v1";

export const GET = api<{ id: string }>("read", async ({ ctx, params }) => ({ body: await getCertificate(ctx, params.id) }));
