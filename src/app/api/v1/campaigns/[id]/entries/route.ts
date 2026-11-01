import { api, pageParams } from "@/server/api/http";
import { createEntry, listEntries } from "@/server/api/v1";
import { hasScope } from "@/server/apikeys";

export const GET = api<{ id: string }>("read", async ({ ctx, params, query, principal }) => {
  const { page, perPage } = pageParams(query);
  return { body: await listEntries(ctx, params.id, { status: query.get("status") ?? undefined, q: query.get("q") ?? undefined, page, perPage }, hasScope(principal, "pii")) };
});

export const POST = api<{ id: string }>("write", async ({ ctx, params, json }) => createEntry(ctx, params.id, await json()));
