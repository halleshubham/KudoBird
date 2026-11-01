import { api } from "@/server/api/http";
import { revoke } from "@/server/api/v1";

export const POST = api<{ id: string }>("write", async ({ ctx, params, json }) => ({ body: await revoke(ctx, params.id, (await json()).reason) }));
