"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createApiKey, revokeApiKey } from "@/server/apikeys";
import { EntitlementError } from "@/server/entitlements";
import { OrgError } from "@/server/orgs";
import { ForbiddenError } from "@/server/permissions";
import { createWebhookEndpoint, deleteWebhookEndpoint, redeliverWebhook, rotateWebhookSecret, sendTestWebhook, updateWebhookEndpoint } from "@/server/webhooks";
import { requireOrg } from "@/server/session";

export type Reveal = { label: string; value: string };
export type DevState = { error?: string; info?: string; reveal?: Reveal } | undefined;
const fail = (e: unknown): DevState => {
  if (e instanceof ForbiddenError) return { error: "You do not have permission to do that" };
  if (e instanceof OrgError || e instanceof EntitlementError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Invalid input" };
  console.error(e);
  return { error: "Something went wrong" };
};
const done = (info: string, reveal?: Reveal): DevState => { revalidatePath("/app/developers"); return { info, reveal }; };

export async function createKeyAction(_: DevState, fd: FormData): Promise<DevState> {
  try {
    const { ctx } = await requireOrg("apikeys.manage");
    const days = Number(fd.get("expiresInDays"));
    const { key } = await createApiKey(ctx, { name: String(fd.get("name") ?? ""), scopes: fd.getAll("scopes").map(String), expiresInDays: days > 0 ? days : null });
    return done("Key created. Copy it now: it will not be shown again.", { label: "Your API key", value: key });
  } catch (e) { return fail(e); }
}
export async function revokeKeyAction(_: DevState, fd: FormData): Promise<DevState> {
  try { const { ctx } = await requireOrg("apikeys.manage"); await revokeApiKey(ctx, z.string().uuid().parse(fd.get("id"))); return done("Key revoked"); } catch (e) { return fail(e); }
}

export async function createWebhookAction(_: DevState, fd: FormData): Promise<DevState> {
  try {
    const { ctx } = await requireOrg("apikeys.manage");
    const { secret } = await createWebhookEndpoint(ctx, { url: String(fd.get("url") ?? ""), events: fd.getAll("events").map(String), description: String(fd.get("description") ?? ""), includePii: fd.get("includePii") === "on" });
    return done("Webhook created. Copy the signing secret now: it will not be shown again.", { label: "Signing secret", value: secret });
  } catch (e) { return fail(e); }
}
const id = (fd: FormData, k = "id") => z.string().uuid().parse(fd.get(k));
export async function toggleWebhookAction(_: DevState, fd: FormData): Promise<DevState> {
  try { const { ctx } = await requireOrg("apikeys.manage"); await updateWebhookEndpoint(ctx, id(fd), { active: fd.get("active") === "1" }); return done("Updated"); } catch (e) { return fail(e); }
}
export async function rotateSecretAction(_: DevState, fd: FormData): Promise<DevState> {
  try { const { ctx } = await requireOrg("apikeys.manage"); const { secret } = await rotateWebhookSecret(ctx, id(fd)); return done("Secret rotated. The old one stops working immediately.", { label: "New signing secret", value: secret }); } catch (e) { return fail(e); }
}
export async function deleteWebhookAction(_: DevState, fd: FormData): Promise<DevState> {
  try { const { ctx } = await requireOrg("apikeys.manage"); await deleteWebhookEndpoint(ctx, id(fd)); return done("Deleted"); } catch (e) { return fail(e); }
}
export async function testWebhookAction(_: DevState, fd: FormData): Promise<DevState> {
  try { const { ctx } = await requireOrg("apikeys.manage"); await sendTestWebhook(ctx, id(fd)); return done("Test event queued. It is sent within a few seconds."); } catch (e) { return fail(e); }
}
export async function redeliverAction(_: DevState, fd: FormData): Promise<DevState> {
  try { const { ctx } = await requireOrg("apikeys.manage"); await redeliverWebhook(ctx, id(fd)); return done("Queued again"); } catch (e) { return fail(e); }
}
