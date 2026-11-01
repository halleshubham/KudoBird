"use server";
import { revalidatePath } from "next/cache";
import { commitBulk, previewBulk, type BulkPreview, type BulkResult } from "@/server/bulk";
import { EntitlementError } from "@/server/entitlements";
import { OrgError } from "@/server/orgs";
import { ForbiddenError } from "@/server/permissions";
import { eraseEntry, exportEntryData } from "@/server/privacy";
import { requireOrg } from "@/server/session";

const MAX_TEXT = 2_000_000; // ~2 MB of CSV
const msg = (e: unknown) => {
  if (e instanceof ForbiddenError) return "You do not have permission to do that";
  if (e instanceof OrgError || e instanceof EntitlementError) return e.message;
  console.error(e);
  return "Something went wrong";
};

export async function previewBulkAction(campaignId: string, text: string): Promise<{ preview?: BulkPreview; error?: string }> {
  try {
    const { ctx } = await requireOrg("entries.manage");
    if (text.length > MAX_TEXT) return { error: "File is too large (limit about 2 MB)" };
    return { preview: await previewBulk(ctx, campaignId, text) };
  } catch (e) { return { error: msg(e) }; }
}

export async function commitBulkAction(campaignId: string, text: string, attested: boolean, sendEmails: boolean): Promise<{ result?: BulkResult; error?: string }> {
  try {
    const { ctx } = await requireOrg("entries.manage");
    if (text.length > MAX_TEXT) return { error: "File is too large (limit about 2 MB)" };
    const result = await commitBulk(ctx, campaignId, text, { attested, sendEmails });
    revalidatePath(`/app/campaigns/${campaignId}/entries`);
    return { result };
  } catch (e) { return { error: msg(e) }; }
}

export async function eraseEntryAction(fd: FormData) {
  const { ctx } = await requireOrg("entries.manage");
  await eraseEntry(ctx, String(fd.get("entryId")));
  revalidatePath(`/app/campaigns/${String(fd.get("campaignId"))}/entries`);
}

export async function exportEntryDataAction(entryId: string) {
  try {
    const { ctx } = await requireOrg("entries.manage");
    return { data: await exportEntryData(ctx, entryId) };
  } catch (e) { return { error: msg(e) }; }
}
